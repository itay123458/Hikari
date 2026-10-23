<?php
// Run inside the image against its local server. Never calls Discord.
$routes=['anime/1/full','anime/1/characters','anime/1/recommendations','anime/1/relations','anime/1/streaming','anime/1/news','anime/21/news','anime/1/videos','anime?q=naruto&limit=10&sfw=true','anime?order_by=popularity&sort=asc&type=tv&limit=10&sfw=true','characters?q=spike&limit=10','characters/1/full','people?q=hayashibara&limit=10','people/14/full','seasons/2026/fall?limit=10&sfw=true','seasons/upcoming?limit=10&sfw=true','genres/anime'];
if (count($argv)>1) $routes=array_slice($argv,1);
$failed=0;
foreach($routes as $route) {
    $body=file_get_contents('http://127.0.0.1:8080/v4/'.$route,false,stream_context_create(['http'=>['ignore_errors'=>true,'timeout'=>120]]));
    $response=json_decode($body,true);
    $ok=isset($response['data'])&&is_array($response['data'])&&count($response['data'])>0;
    $data=$response['data']??[];
    if ($route==='anime/1/full') $ok=$ok&&($data['mal_id']??null)===1&&isset($data['aired']['prop']['from']['year'])&&isset($data['images']['jpg']['image_url']);
    if ($route==='anime/1/full') $ok=$ok&&($data['aired']['prop']['from']??null)===['day'=>3,'month'=>4,'year'=>1998]&&str_starts_with($data['url']??'','https://myanimelist.net/anime/1/')&&preg_match('~^https://www.youtube.com/watch\?v=[A-Za-z0-9_-]{11}$~',$data['trailer']['url']??'');
    if ($route==='anime/1/relations') $ok=$ok&&isset($data[0]['relation'],$data[0]['entry'][0]['mal_id'],$data[0]['entry'][0]['type'],$data[0]['entry'][0]['url']);
    if ($route==='people/14/full') $ok=$ok&&!empty($data['voices'][0]['character']['name'])&&!empty($data['voices'][0]['anime']['title']);
    if ($route==='characters/1/full') $ok=$ok&&!empty($data['voices'][0]['person']['name']);
    if (str_contains($route,'/news')) $ok=$ok&&isset($data[0]['mal_id'],$data[0]['url'],$data[0]['date'],$data[0]['excerpt']);
    if (str_contains($route,'/recommendations')) $ok=$ok&&isset($data[0]['entry']['mal_id']);
    if (!$ok) $failed++;
    echo json_encode(['route'=>$route,'ok'=>$ok,'status'=>$http_response_header[0]??null,'count'=>count($data),'keys'=>array_keys($data[0]??$data),'first'=>$data[0]['title']??$data[0]['name']??$data['title']??$data['name']??null,'error'=>$response['message']??null],JSON_UNESCAPED_SLASHES)."\n";
}
exit($failed?1:0);
