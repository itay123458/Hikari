<?php
declare(strict_types=1);

function bridgeRemaining(float $wait=0): float {
    $remaining=($GLOBALS['bridge_deadline']??INF)-microtime(true);
    if ($remaining<=$wait) throw new RuntimeException('Request budget exhausted; narrow the filters and retry.',503);
    return $remaining;
}

function bridgeTrailer(array $trailer): array {
    // MAL's official parser currently misses privacy-enhanced embed IDs. Only
    // recover the exact source ID; leave absent artwork and other fields alone.
    if (empty($trailer['youtube_id']) && preg_match('~^https://www\.youtube-nocookie\.com/embed/([A-Za-z0-9_-]{11})(?:[?/#]|$)~D',$trailer['embed_url']??'',$match)) {
        $trailer['youtube_id']=$match[1];
        $trailer['url']='https://www.youtube.com/watch?v='.$match[1];
    }
    return $trailer;
}

// MAL search pages contain 50 results; the client asks for ten. Slice only
// after merging/filtering upstream pages so page two never skips forty titles.
function bridgePage(callable $fetch, int $page, int $limit, ?callable $filter=null): array {
    $offset = ($page-1)*$limit;
    $rows=[]; $next=true;
    for ($upstream=1; $next && count($rows)<$offset+$limit+1; $upstream++) {
        bridgeRemaining();
        if ($upstream>20) throw new RuntimeException('Search exceeds bounded upstream scan; narrow the filters.',503);
        $batch=$fetch($upstream); $next=$batch['next'];
        foreach ($batch['rows'] as $row) {
            if ($filter && !$filter($row)) continue;
            $rows[]=$row;
        }
    }
    $hasNext=count($rows)>$offset+$limit || $next;
    return ['data'=>array_slice($rows,$offset,$limit), 'pagination'=>[
        'current_page'=>$page, 'has_next_page'=>$hasNext,
        'last_visible_page'=>$hasNext ? $page+1 : max(1,(int)ceil(count($rows)/$limit)),
        'items'=>['count'=>count(array_slice($rows,$offset,$limit)), 'per_page'=>$limit]
    ]];
}
function bridgeSfw(array $row): bool {
    if (($row['r18']??false)===true) return false;
    $rating=$row['rated']??$row['rating']??null;
    if ($rating!==null && preg_match('/^(Rx|R\+)/i',$rating)) return false;
    foreach (array_merge($row['genres']??[],$row['explicit_genres']??[]) as $genre) {
        if (in_array($genre['mal_id']??0,[12,49],true)) return false;
    }
    // A missing age rating is unknown, not an assertion that the title is safe.
    $knownRating=is_string($rating)&&preg_match('/^(G|PG|PG-13|R)(?:\s|$)/i',$rating);
    return (bool)$knownRating || (array_key_exists('r18',$row)&&$row['r18']===false);
}
function bridgeCache(string $key, callable $fetch): array {
    bridgeRemaining();
    $dir=getenv('JIKAN_CACHE_DIR')?:'/tmp/jikan-cache';
    if (!is_dir($dir) && !mkdir($dir,0700,true) && !is_dir($dir)) throw new RuntimeException('Cache unavailable',503);
    $file=$dir.'/'.hash('sha256',$key).'.json';
    if (is_file($file) && filemtime($file)>time()-86400) {
        $data=json_decode(file_get_contents($file),true);
        if (is_array($data)) return $data;
    }
    $lock=fopen($dir.'/upstream.lock','c+');
    if (!$lock) throw new RuntimeException('Upstream lock unavailable',503);
    while (!flock($lock,LOCK_EX|LOCK_NB)) {
        try { bridgeRemaining(0.05); } catch (Throwable $e) { fclose($lock); throw $e; }
        usleep(50000);
    }
    try {
        bridgeRemaining();
        foreach (glob($dir.'/pending-*') as $abandoned) if (filemtime($abandoned)<time()-3600) unlink($abandoned);
        if (is_file($file) && filemtime($file)>time()-86400) {
            $data=json_decode(file_get_contents($file),true);
            if (is_array($data)) return $data;
        }
        rewind($lock); $last=(float)stream_get_contents($lock);
        $wait=1.1-(microtime(true)-$last);
        if ($wait>0) { bridgeRemaining($wait); usleep((int)($wait*1000000)); }
        bridgeRemaining();
        // Record before fetching, including failures, to avoid retry storms.
        ftruncate($lock,0); rewind($lock); fwrite($lock,(string)microtime(true)); fflush($lock);
        $data=$fetch();
        bridgeRemaining();
        $json=json_encode($data,JSON_THROW_ON_ERROR|JSON_UNESCAPED_SLASHES);
        $temp=tempnam($dir,'pending-');
        if ($temp===false || file_put_contents($temp,$json,LOCK_EX)!==strlen($json)) {
            if ($temp!==false) unlink($temp);
            throw new RuntimeException('Cache write failed',503);
        }
        if (!rename($temp,$file)) { unlink($temp); throw new RuntimeException('Cache publication failed',503); }
        $files=glob($dir.'/*.json');
        usort($files,fn($a,$b)=>filemtime($a)<=>filemtime($b));
        $bytes=array_sum(array_map('filesize',$files)); $count=count($files);
        foreach ($files as $old) {
            if ($count<=500 && $bytes<=32*1024*1024) break;
            $bytes-=filesize($old); $count--; unlink($old);
        }
        return $data;
    } finally { flock($lock,LOCK_UN); fclose($lock); }
}
