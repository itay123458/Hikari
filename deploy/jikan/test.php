<?php
require __DIR__.'/bridge.php';
set_error_handler(function($severity,$message){throw new RuntimeException($message);});
function check($ok, $message) { if (!$ok) throw new Exception($message); }
$sourceTrailer=['youtube_id'=>null,'url'=>null,'embed_url'=>'https://www.youtube-nocookie.com/embed/gY5nDXOtv_o?enablejsapi=1','images'=>['image_url'=>null]];
$fixedTrailer=bridgeTrailer($sourceTrailer);
check($fixedTrailer['youtube_id']==='gY5nDXOtv_o','trailer source ID');
check($fixedTrailer['url']==='https://www.youtube.com/watch?v=gY5nDXOtv_o','trailer canonical URL');
check($fixedTrailer['images']===['image_url'=>null],'unknown trailer images changed');
foreach (['https://evil.example/embed/gY5nDXOtv_o','https://www.youtube-nocookie.com/embed/gY5nDXOtv_oEXTRA','https://www.youtube-nocookie.com/embed/short','https://www.youtube-nocookie.com.evil.example/embed/gY5nDXOtv_o'] as $embed) {
    $unknown=['youtube_id'=>null,'url'=>null,'embed_url'=>$embed];
    check(bridgeTrailer($unknown)===$unknown,'unrecognized embed inferred a trailer');
}
$fetch = function($page) { return ['rows'=>array_map(fn($id)=>['mal_id'=>$id], range(($page-1)*50+1,$page*50)), 'next'=>$page<3]; };
foreach ([1,5,6,10,11,15] as $page) {
    $r = bridgePage($fetch,$page,10);
    check(array_column($r['data'],'mal_id') === range(($page-1)*10+1,$page*10), "page $page skips entries");
    check($r['pagination']['has_next_page'] === ($page<15), 'incorrect next page');
}
check(bridgePage($fetch,16,10)['data'] === [], 'past end must be empty');
$filtered = bridgePage($fetch,5,10,fn($r)=>$r['mal_id']%2===0);
check(array_column($filtered['data'],'mal_id')===range(82,100,2),'filter pagination');
check(!bridgeSfw(['rated'=>'Rx']), 'explicit rating must be excluded');
check(!bridgeSfw(['rated'=>'R+']), 'nudity rating must be excluded');
check(bridgeSfw(['rated'=>'PG-13']), 'ordinary rating must be included');
check(!bridgeSfw(['r18'=>true,'genres'=>[]]), 'season adult flag');
check(bridgeSfw(['r18'=>false,'genres'=>[]]), 'known season nonadult flag');
check(!bridgeSfw(['genres'=>[]]), 'unknown rating with empty genres');
check(!bridgeSfw([]), 'unknown rating without source flag');
check(!bridgeSfw(['rated'=>'unknown']), 'unrecognized rating');
check(!bridgeSfw(['r18'=>false,'genres'=>[['mal_id'=>12]]]), 'explicit genre overrides source flag');
$GLOBALS['bridge_deadline']=microtime(true)-1;
$budgetCalls=0;
try {
    bridgePage(function()use(&$budgetCalls){$budgetCalls++;return ['rows'=>[],'next'=>false];},1,10);
    throw new Exception('expired page budget accepted');
} catch(RuntimeException $e) { check($e->getCode()===503,'expired budget status'); }
try {
    bridgeCache('expired',function()use(&$budgetCalls){$budgetCalls++;return [];});
    throw new Exception('expired cache budget accepted');
} catch(RuntimeException $e) { check($e->getCode()===503,'expired cache budget status'); }
check($budgetCalls===0,'expired budget invokes fetch');
unset($GLOBALS['bridge_deadline']);
$dir=(getenv('JIKAN_CACHE_DIR')?:sys_get_temp_dir()).'/jikan-test-'.bin2hex(random_bytes(8));
putenv('JIKAN_CACHE_DIR='.$dir);
$calls=0;
$loader=function()use(&$calls){$calls++;return ['data'=>['mal_id'=>1]];};
check(bridgeCache('ok',$loader)===bridgeCache('ok',$loader),'cache changes shape');
check($calls===1,'cache refetches a successful response');
$GLOBALS['bridge_deadline']=microtime(true)-1;
try { bridgeCache('ok',$loader); throw new Exception('expired cache hit accepted'); }
catch(RuntimeException $e) { check($e->getCode()===503,'expired cache hit status'); }
check($calls===1,'expired cached request refetches');
$GLOBALS['bridge_deadline']=microtime(true)+0.1;
try { bridgeCache('pacing',$loader); throw new Exception('pacing exceeds request budget'); }
catch(RuntimeException $e) { check($e->getCode()===503,'pacing budget status'); }
check($calls===1,'pacing timeout invokes fetch');
unset($GLOBALS['bridge_deadline']);
try { bridgeCache('failure',fn()=>throw new RuntimeException('upstream failed',429)); } catch(RuntimeException $e) {}
check(!is_file($dir.'/'.hash('sha256','failure').'.json'),'failures poison cache');
check(bridgeCache('failure',fn()=>['recovered'=>true])===['recovered'=>true],'failure prevents recovery');
file_put_contents($dir.'/'.hash('sha256','corrupt').'.json','{broken');
check(bridgeCache('corrupt',fn()=>['repaired'=>true])===['repaired'=>true],'corrupt cache prevents recovery');
// Seed directly: capacity tests must not make hundreds of upstream calls.
for ($n=0;$n<501;$n++) file_put_contents($dir.'/'.hash('sha256','seed'.$n).'.json',str_repeat('x',70000));
bridgeCache('prune',fn()=>['ok'=>true]);
$files=glob($dir.'/*.json');
check(count($files)<=500,'entry capacity exceeded');
check(array_sum(array_map('filesize',$files))<=32*1024*1024,'byte capacity exceeded');
foreach(glob($dir.'/*') as $file) unlink($file);
rmdir($dir);
echo "bridge tests passed\n";
