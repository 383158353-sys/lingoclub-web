import React from "react";
import { Bookmark } from "lucide-react";

// 备选书签工具：在 YouTube 原页面提取 CC 字幕 → SRT → 剪贴板
// 策略：① Polymer __data 数据模型提取（最可靠） ② DOM 选择器（新旧 UI 兼容）
//       ③ 自动打开转录面板 ④ ytInitialPlayerResponse timedtext
// 当主书签（导入到 LinguaTube）提取失败时，用此工具手动提取并粘贴。
const bookmarkletCode = `(function(){
function copy(t,m){
if(navigator.clipboard&&navigator.clipboard.writeText){
navigator.clipboard.writeText(t).then(function(){alert(m)}).catch(function(){fb(t,m)})
}else{fb(t,m)}
}
function fb(t,m){
var ta=document.createElement('textarea');ta.value=t;
ta.style.position='fixed';ta.style.top='-9999px';
document.body.appendChild(ta);ta.select();
try{document.execCommand('copy')}catch(e){}
document.body.removeChild(ta);alert(m)
}
function ts(s){
var h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sc=Math.floor(s%60),ms=Math.floor((s%1)*1000);
function p(n,w){return String(n).padStart(w,'0')}
return p(h,2)+':'+p(m,2)+':'+p(sc,2)+','+p(ms,3)
}
function parseTime(str){if(!str)return 0;var p=String(str).trim().split(':').map(function(n){return parseInt(n,10)||0;});if(p.length===3)return p[0]*3600+p[1]*60+p[2];if(p.length===2)return p[0]*60+p[1];return 0;}
function linesToSrt(lines){
if(!lines||!lines.length)return'';
var L=[],i=0;
lines.forEach(function(l){
if(!l.text_en)return;
i++;
var st=parseTime(l.time_start)||0;
var du=parseTime(l.time_end)-st||2;
L.push(i+'\\n'+ts(st)+' --> '+ts(st+du)+'\\n'+l.text_en)
});
return L.join('\\n\\n')
}
function extractFromPolymer(){
try{
var els=document.querySelectorAll('ytd-transcript-renderer, ytd-transcript-search-panel-renderer, ytd-transcript-segment-list-renderer');
for(var i=0;i<els.length;i++){
var el=els[i];
var data=el.__data&&el.__data.data;
if(!data)continue;
var cueGroups=null;
if(data.body&&data.body.transcriptBodyRenderer){cueGroups=data.body.transcriptBodyRenderer.cueGroups;}
else if(data.transcriptBodyRenderer){cueGroups=data.transcriptBodyRenderer.cueGroups;}
if(!cueGroups||!cueGroups.length)continue;
var lines=[];
cueGroups.forEach(function(cg){
var cues=(cg.transcriptCueGroupRenderer||{}).cues||[];
cues.forEach(function(cue){
var cr=cue.transcriptCueRenderer;
if(!cr)return;
var text='';
if(cr.cue&&cr.cue.runs){text=cr.cue.runs.map(function(r){return r.text||'';}).join('').trim();}
else if(cr.cue&&cr.cue.simpleText){text=cr.cue.simpleText.trim();}
if(text){
var startMs=Number(cr.startMs||0);
var durMs=Number(cr.durationMs||0);
function fmt(s){s=Math.floor(s||0);var h=Math.floor(s/3600),m=Math.floor((s%3600)/60),x=s%60;if(h>0)return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(x).padStart(2,'0');return String(m).padStart(2,'0')+':'+String(x).padStart(2,'0');}
lines.push({text_en:text,time_start:fmt(startMs/1000),time_end:fmt((startMs+durMs)/1000)});
}
});
});
if(lines.length)return lines;
}
}catch(e){}
return null;
}
function extractFromDOM(){
var lines=[];
var segs=document.querySelectorAll('ytd-transcript-segment-renderer');
if(!segs.length)segs=document.querySelectorAll('transcript-segment-view-model');
if(!segs.length)segs=document.querySelectorAll('[class*="transcript-segment"]');
if(!segs.length){
var panel=document.querySelector('ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]')||document.querySelector('ytd-engagement-panel-section-list-renderer[target-id="PAmodern_transcript_view"]');
if(panel){segs=panel.querySelectorAll('ytd-transcript-segment-renderer, transcript-segment-view-model, [class*="segment"]');}
}
if(!segs.length)return null;
segs.forEach(function(s){
var timeStr='';
var text='';
var timeEl=s.querySelector('.segment-start-offset, [class*="start-offset"], [class*="timestamp"]');
var textEl=s.querySelector('.segment-text, [class*="segment-text"]');
if(timeEl)timeStr=timeEl.textContent.trim();
if(textEl)text=textEl.textContent.trim();
if(!text){
var strs=s.querySelectorAll('.yt-core-attributed-string');
var parts=[];
for(var j=0;j<strs.length;j++){
var c=strs[j].textContent.trim();
if(!c)continue;
if(!timeStr&&/^\\d{1,2}:\\d{2}(:\\d{2})?$/.test(c)){timeStr=c;}
else{parts.push(c);}
}
text=parts.join(' ').trim();
}
if(!text){
var allText=s.textContent.trim();
var tm=allText.match(/(\\d{1,2}:\\d{2}(:\\d{2})?)/);
if(tm){timeStr=tm[1];text=allText.replace(timeStr,'').trim();}
else{text=allText;}
}
if(text)lines.push({text_en:text,time_start:timeStr,time_end:''});
});
return lines.length?lines:null;
}
function openTranscriptPanel(){
var els=document.querySelectorAll('button,yt-button-renderer,tp-yt-paper-button,ytd-button-renderer,ytd-menu-item-renderer');
var keywords=['transcript','转录','转写','文字稿','显示转写文稿'];
for(var i=0;i<els.length;i++){
var el=els[i];
var txt=(el.textContent||'').toLowerCase().trim();
var aria=(el.getAttribute('aria-label')||'').toLowerCase().trim();
for(var k=0;k<keywords.length;k++){
if(txt.indexOf(keywords[k])>-1||aria.indexOf(keywords[k])>-1){
try{el.click();}catch(e){}
return true;
}
}
}
return false;
}
function done(lines){
lines=(lines||[]).map(function(l){l.text_en=(l.text_en||'').replace(/<s\b[^>]*>/gi,'s').replace(/<\\/s\b[^>]*>/gi,'').replace(/<\\/?[a-z][^>]*>/gi,'').replace(/\\s+/g,' ').trim();return l;}).filter(function(l){return l.text_en;});
var s=linesToSrt(lines);
if(!s){alert('字幕内容为空');return}
var n=s.split('\\n\\n').length;
copy(s,'\\u2705 已复制'+n+'条字幕到剪贴板!\\n请回到 LingoClub 学习页面,在「粘贴/文件导入」标签中粘贴。')
}
function fetchFromAPI(){
function processJson3(txt){
if(!txt||!txt.trim()||txt.trim().charAt(0)!=='{')return[];
try{
var data=JSON.parse(txt);
function fmtT(s){s=s||0;var h=Math.floor(s/3600),m=Math.floor((s%3600)/60),x=s-h*3600-m*60;var ss=Math.floor(x),ms=Math.floor((x-ss)*1000);function p(n,w){return String(n).padStart(w,'0')}if(h>0)return p(h,2)+':'+p(m,2)+':'+p(ss,2)+','+p(ms,3);return p(m,2)+':'+p(ss,2)+','+p(ms,3);}
var allL=[];
(data.events||[]).filter(function(e){return e.segs;}).forEach(function(e){
var tx=(e.segs||[]).map(function(sg){return sg.utf8||'';}).join('').replace(/\\n/g,' ');
tx=tx.replace(/<s\b[^>]*>/gi,'s').replace(/<\\/s\b[^>]*>/gi,'').replace(/<\\/?[a-z][^>]*>/gi,'').replace(/\\s+/g,' ').trim();
if(!tx)return;
var st=e.tStartMs/1000;var du=(e.dDurationMs||0)/1000;
if(!du)du=Math.max(1.5,Math.min(8,tx.length*0.08));
var ws=tx.split(/\\s+/);
var tl=0;for(var i=0;i<ws.length;i++)tl+=ws[i].length;
if(!tl)tl=1;
var ac=st;
for(var i=0;i<ws.length;i++){
var wd=Math.max(0.1,(ws[i].length/tl)*du);
allL.push({text_en:ws[i],time_start:fmtT(ac),time_end:fmtT(ac+wd)});
ac+=wd;
}
});
return allL;
}catch(e){return[];}
}
function fetchTrack(bu){
bu=(bu||'').replace(/[?&]fmt=[^&]+/g,'');
if(!bu)return Promise.resolve([]);
var sep=bu.indexOf('?')>-1?'&':'?';
return fetch(bu+sep+'fmt=json3',{credentials:'include'}).then(function(r){
if(!r.ok)return[];
return r.text();
}).then(processJson3).catch(function(){return[];});
}
function pickTrack(tracks){
if(!tracks||!tracks.length)return null;
return tracks.find(function(t){return t.languageCode&&t.languageCode.indexOf('en')===0;})||tracks[0];
}
var pr=window.ytInitialPlayerResponse;
if(pr&&pr.captions){
try{
var tracks=pr.captions.playerCaptionTracklistRenderer.captionTracks||[];
var track=pickTrack(tracks);
if(track&&track.baseUrl)return fetchTrack(track.baseUrl);
}catch(e){}
}
return fetch(location.href,{credentials:'include'}).then(function(r){
if(!r.ok)return[];
return r.text();
}).then(function(html){
if(!html)return[];
var m=html.match(/"captionTracks":(\\[[\\s\\S]*?\\])/);
if(!m)return[];
try{
var tracks2=JSON.parse(m[1]);
var track2=pickTrack(tracks2);
if(track2&&track2.baseUrl)return fetchTrack(track2.baseUrl);
}catch(e){}
return[];
}).catch(function(){return[];});
}
fetchFromAPI().then(function(lines){
if(lines&&lines.length){done(lines);return;}
var polyLines=extractFromPolymer();
if(polyLines){done(polyLines);return;}
var domLines=extractFromDOM();
if(domLines){done(domLines);return;}
if(openTranscriptPanel()){
alert('正在打开转录面板，请等待3秒后再点一次此书签。');
}else{
alert('未找到字幕。请确认视频有CC字幕轨，或等待3秒后重试。');
}
});
})()`;

const bookmarkletHref = "javascript:" + encodeURIComponent(bookmarkletCode);

export default function YoutubeSubtitleHelper({ forceMode }) {
  const isMobile = forceMode === "mobile" ? true : forceMode === "desktop" ? false : (typeof window !== "undefined" && (
    Math.min(window.innerWidth, window.innerHeight) < 768 ||
    ("ontouchstart" in window && navigator.maxTouchPoints > 0)
  ));
  return (
    <div className="rounded-xl border border-copper/30 bg-copper/5 p-4">
      <div className="flex items-center gap-2">
        <Bookmark size={14} className="text-copper" />
        <h4 className="font-display text-sm text-foreground">备选：获取 YouTube 字幕</h4>
      </div>
      {isMobile ? (
        <div className="mt-1.5 space-y-1.5">
          <p className="text-xs leading-relaxed text-muted-foreground">
            字幕自动获取失败？在 YouTube App 打开该视频 → 点击「更多」→「显示转录文字」→ 全选复制，然后回到此处粘贴到字幕管理即可。
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            或返回「我的影片」重新导入，粘贴 YouTube 链接后系统会自动重试获取字幕、标题和封面。
          </p>
        </div>
      ) : (
        <>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            自动提取失败时用此书签：在 YouTube 视频页面点击，会从转录面板的 Polymer 数据模型直接提取 CC 字幕并复制为 SRT 到剪贴板，回来粘贴即可。兼容新旧 YouTube UI，面板未打开时会自动尝试打开。
          </p>
          <a
            href={bookmarkletHref}
            draggable={true}
            onClick={(e) => e.preventDefault()}
            title="拖拽此按钮到浏览器书签栏"
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-copper px-4 py-2.5 text-sm font-medium text-copper-foreground transition-transform hover:scale-[1.02] cursor-grab active:cursor-grabbing"
          >
            <Bookmark size={15} /> 导入到 LingoClub
          </a>
          <ol className="mt-4 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
            <li className="flex gap-2"><span className="text-copper font-medium">1.</span> 将上方按钮拖到浏览器书签栏（如未显示，按 Ctrl+Shift+B 开启）</li>
            <li className="flex gap-2"><span className="text-copper font-medium">2.</span> 在 YouTube 视频页面点击此书签</li>
            <li className="flex gap-2"><span className="text-copper font-medium">3.</span> 脚本自动提取字幕并复制 SRT 到剪贴板</li>
            <li className="flex gap-2"><span className="text-copper font-medium">4.</span> 如果提示「正在打开转录面板」，等 3 秒后再点一次书签</li>
            <li className="flex gap-2"><span className="text-copper font-medium">5.</span> 回到学习页，在下方「字幕管理 → 粘贴/文件导入」中 Ctrl+V 粘贴</li>
          </ol>
        </>
      )}
    </div>
  );
}