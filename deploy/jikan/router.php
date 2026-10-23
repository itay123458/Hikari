<?php
declare(strict_types=1);
ini_set('memory_limit','96M');
ini_set('display_errors','0');
ini_set('log_errors','1');
require __DIR__.'/bridge.php';
$GLOBALS['bridge_deadline']=microtime(true)+25;

function failRequest(string $message,int $status=400): never { throw new RuntimeException($message,$status); }
function allowedQuery(array $names): void {
    foreach ($_GET as $key=>$value) if (!in_array($key,$names,true)||!is_string($value)) failRequest('Unsupported query parameter: '.$key);
}
function integerQuery(string $key,int $default,int $max): int {
    $value=$_GET[$key]??(string)$default;
    if (!preg_match('/^[1-9][0-9]*$/D',$value)||(int)$value>$max) failRequest('Invalid '.$key);
    return (int)$value;
}
function sfwQuery(): bool {
    if (!isset($_GET['sfw'])) return false;
    if (!in_array($_GET['sfw'],['true','false','1','0'],true)) failRequest('Invalid sfw');
    return in_array($_GET['sfw'],['true','1'],true);
}
function serial($model): array {
    static $serializer;
    $serializer??=App\Providers\SerializerFactory::createV4();
    return json_decode($serializer->serialize($model,'json'),true,512,JSON_THROW_ON_ERROR);
}
function upstream(string $method,object $request,?callable $extract=null): array {
    return bridgeCache('v2:'.$method.':'.$request->getPath(),function()use($method,$request,$extract){
        $remaining=min(25,bridgeRemaining());
        $http=Symfony\Component\HttpClient\HttpClient::create(['timeout'=>min(15,$remaining),'max_duration'=>$remaining,'max_redirects'=>3]);
        $client=new Jikan\MyAnimeList\MalClient($http);
        try { $model=$client->$method($request); }
        catch (Throwable $error) { bridgeRemaining(); throw $error; }
        return $extract ? $extract($model) : serial($model);
    });
}
function listAnime(array $row): array {
    // List parsers collapse partial dates to January/the first. Full detail is
    // the authoritative date source and includes MAL's explicit precision.
    if (!isset($row['aired'])) $row['aired']=['from'=>null,'to'=>null];
    unset($row['start_date'],$row['end_date'],$row['airing_start']);
    return $row;
}
function animeDetail(int $id): array {
    $row=upstream('getAnime',new Jikan\Request\Anime\AnimeRequest($id));
    $relations=[];
    foreach ($row['related']??[] as $relation=>$entry) $relations[]=['relation'=>$relation,'entry'=>$entry];
    $row['relations']=$relations;
    $row['streaming']=$row['streaming_links']??[];
    $row['external']=$row['external_links']??[];
    $row['theme']=['openings'=>$row['opening_themes']??[],'endings'=>$row['ending_themes']??[]];
    // The parser currently misses youtube_id for MAL's privacy-enhanced embeds.
    if (empty($row['trailer']['youtube_id']) && preg_match('~^https://www\.youtube-nocookie\.com/embed/([A-Za-z0-9_-]{11})(?:[?/] |[?]|$)~x',$row['trailer']['embed_url']??'',$m)) {
        $row['trailer']['youtube_id']=$m[1];
        $row['trailer']['url']='https://www.youtube.com/watch?v='.$m[1];
    }
    return $row;
}
function searchRoute(string $kind): array {
    allowedQuery($kind==='anime'?['q','genres','status','type','min_score','order_by','sort','page','limit','sfw']:['q','page','limit']);
    $page=integerQuery('page',1,100); $limit=integerQuery('limit',10,25); $sfw=sfwQuery();
    $q=$_GET['q']??'';
    if (strlen($q)>200 || ($q!==''&&mb_strlen($q)<3)) failRequest('Search query must contain 3–200 characters');
    if ($kind==='anime') {
        $request=new Jikan\Request\Search\AnimeSearchRequest($q);
        $maps=['type'=>['tv'=>1,'ova'=>2,'movie'=>3,'special'=>4,'ona'=>5,'music'=>6,'cm'=>7,'pv'=>8,'tv_special'=>9],
               'status'=>['airing'=>1,'complete'=>2,'upcoming'=>3],
               'order_by'=>['title'=>0,'start_date'=>2,'score'=>3,'episodes'=>4,'end_date'=>5,'type'=>6,'members'=>7,'popularity'=>7,'mal_id'=>9]];
        foreach ($maps as $key=>$map) if (isset($_GET[$key])) {
            if (!isset($map[$_GET[$key]])) failRequest('Unsupported '.$key);
            $method=['type'=>'setType','status'=>'setStatus','order_by'=>'setOrderBy'][$key];
            $request->$method($key==='type'?(string)$map[$_GET[$key]]:$map[$_GET[$key]]);
        }
        if (isset($_GET['min_score'])) {
            if (!is_numeric($_GET['min_score'])||(float)$_GET['min_score']<0||(float)$_GET['min_score']>10) failRequest('Invalid min_score');
            $request->setScore((float)$_GET['min_score']);
        }
        if (isset($_GET['genres'])) {
            if (!preg_match('/^[1-9][0-9]*(,[1-9][0-9]*){0,9}$/D',$_GET['genres'])) failRequest('Invalid genres');
            $request->setGenre(...array_map('intval',explode(',',$_GET['genres'])));
        }
        if (isset($_GET['sort'])&&!in_array($_GET['sort'],['asc','desc'],true)) failRequest('Invalid sort');
        $descending=($_GET['sort']??'asc')==='desc';
        // MAL popularity is the inverse of its member count ordering.
        if (($_GET['order_by']??'')==='popularity') $descending=!$descending;
        $request->setSort($descending?1:0);
        $method='getAnimeSearch';
    } else {
        $request=$kind==='characters'?new Jikan\Request\Search\CharacterSearchRequest($q):new Jikan\Request\Search\PersonSearchRequest($q);
        $method=$kind==='characters'?'getCharacterSearch':'getPersonSearch';
    }
    return bridgePage(function($n)use($request,$method,$kind){
        $request->setPage($n);
        return upstream($method,$request,fn($model)=>['rows'=>array_map(fn($item)=>$kind==='anime'?listAnime(serial($item)):serial($item),$model->getResults()),'next'=>$model->hasNextPage()]);
    },$page,$limit,$sfw?'bridgeSfw':null);
}
function route(string $path): array {
    if ($path==='/healthz') { allowedQuery([]); return ['status'=>'ok']; }
    if (preg_match('~^/v4/(anime|characters|people)$~D',$path,$m)) return searchRoute($m[1]);
    if (preg_match('~^/v4/anime/([1-9][0-9]{0,8})(?:/(full|characters|recommendations|relations|streaming|news|videos))?$~D',$path,$m)) {
        allowedQuery([]); $id=(int)$m[1]; $part=$m[2]??'full';
        if (in_array($part,['full','relations','streaming'],true)) {
            $row=animeDetail($id); return ['data'=>$part==='full'?$row:$row[$part]];
        }
        $spec=['characters'=>['getAnimeCharactersAndStaff',Jikan\Request\Anime\AnimeCharactersAndStaffRequest::class],
            'recommendations'=>['getAnimeRecommendations',Jikan\Request\Anime\AnimeRecommendationsRequest::class],
            'news'=>['getNewsList',Jikan\Request\Anime\AnimeNewsRequest::class],
            'videos'=>['getAnimeVideos',Jikan\Request\Anime\AnimeVideosRequest::class]][$part];
        $data=upstream($spec[0],new $spec[1]($id),fn($model)=>serial($part==='characters'?$model->getCharacters():($part==='news'?$model->getResults():$model)));
        return ['data'=>$data];
    }
    if (preg_match('~^/v4/(characters|people)/([1-9][0-9]{0,8})(?:/full)?$~D',$path,$m)) {
        allowedQuery([]);
        $row=$m[1]==='characters'?upstream('getCharacter',new Jikan\Request\Character\CharacterRequest((int)$m[2])):upstream('getPerson',new Jikan\Request\Person\PersonRequest((int)$m[2]));
        if ($m[1]==='characters') {
            $row['anime']=$row['animeography']??[]; $row['manga']=$row['mangaography']??[];
            $row['voices']=$row['voice_actors']??[];
        } else {
            $row['voices']=$row['voice_acting_roles']??[];
            $row['anime']=$row['anime_staff_positions']??[]; $row['manga']=$row['published_manga']??[];
        }
        $row['favorites']=$row['member_favorites']??$row['favorites']??null;
        return ['data'=>$row];
    }
    if (preg_match('~^/v4/seasons/(upcoming|([12][0-9]{3})/(winter|spring|summer|fall))$~D',$path,$m)) {
        allowedQuery(['page','limit','sfw']); $page=integerQuery('page',1,100); $limit=integerQuery('limit',10,25); $sfw=sfwQuery();
        $request=$m[1]==='upcoming'?new Jikan\Request\Seasonal\SeasonalRequest(null,null,true):new Jikan\Request\Seasonal\SeasonalRequest((int)$m[2],$m[3]);
        $rows=upstream('getSeasonal',$request,fn($model)=>array_map(fn($item)=>listAnime(serial($item)),$model->getAnime()));
        return bridgePage(fn($n)=>['rows'=>$n===1?$rows:[],'next'=>false],$page,$limit,$sfw?'bridgeSfw':null);
    }
    if ($path==='/v4/genres/anime') {
        allowedQuery([]);
        return ['data'=>upstream('getAnimeGenres',new Jikan\Request\Genre\AnimeGenresRequest(),fn($m)=>serial(array_merge($m->getGenres(),$m->getExplicitGenres(),$m->getThemes(),$m->getDemographics())))];
    }
    failRequest('Unknown route',404);
}

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
try {
    if (($_SERVER['REQUEST_METHOD']??'')!=='GET') failRequest('Only GET is supported',405);
    $path=parse_url($_SERVER['REQUEST_URI'],PHP_URL_PATH);
    // health needs neither the parser nor any external service.
    if ($path!=='/healthz') require '/app/vendor/autoload.php';
    $result=route($path);
    bridgeRemaining();
    echo json_encode($result,JSON_THROW_ON_ERROR|JSON_UNESCAPED_SLASHES);
    error_log('bridge peak bytes: '.memory_get_peak_usage(true));
} catch (Throwable $error) {
    $code=(int)$error->getCode();
    $upstream=$error instanceof Jikan\Exception\BadResponseException;
    $status=in_array($code,[400,404,405,429,503],true)?$code:502;
    if ($upstream && !in_array($code,[404,429],true)) $status=502;
    http_response_code($status);
    if ($status===429||$status===503) header('Retry-After: 30');
    error_log(get_class($error).': '.$error->getMessage());
    echo json_encode(['status'=>$status,'type'=>$upstream?'UpstreamError':'BridgeError','message'=>$status===502?'MAL request or parser failed':$error->getMessage(),'upstream_status'=>$upstream&&$code>=100&&$code<=599?$code:null]);
}
