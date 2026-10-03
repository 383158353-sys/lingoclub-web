import React, { useState, useMemo } from "react";
import { Bookmark, Youtube, Check, Lightbulb, Smartphone, Share, Plus, Monitor, Download } from "lucide-react";

// 书签工具：在 YouTube 页面提取 CC 字幕，新标签页打开学习页。
// 策略：① Polymer __data 数据模型提取（最可靠，直接读 YouTube 内部数据）
//       ② DOM 选择器提取（兼容新旧 UI：ytd-transcript-segment-renderer / transcript-segment-view-model）
//       ③ ytInitialPlayerResponse → timedtext json3 同源 fetch
//       ④ 自动点击「显示转录」按钮 → 等待 → 再次提取
// 用 window.open 新标签页打开，不离开当前 YouTube 页面。
export function buildBookmarklet(appUrl) {
  const code = `(function(){
var u=window.location.href;
var t=document.title.replace(/\\s*-\\s*YouTube\\s*$/,'').replace(/_哔哩哔哩.*/,'').trim();
var app=${JSON.stringify(appUrl)};
var ytUrl=null;try{ytUrl=new URL(u);}catch(e){}
var host=ytUrl?ytUrl.hostname.toLowerCase():'';
var isYoutube=host==='youtu.be'||host==='youtube.com'||host.endsWith('.youtube.com');
var vid=(function(){try{return ytUrl.searchParams.get('v')||(ytUrl.pathname.match(/\\/(?:shorts|live|embed)\\/([A-Za-z0-9_-]{11})/)||[])[1]||(host==='youtu.be'?ytUrl.pathname.split('/')[1]:'')||'';}catch(e){return '';}})();
if(!isYoutube||!vid){alert('请在 YouTube 视频页面点击此书签');return;}
var startedAt=Date.now();
var handoffId=String(Date.now())+'-'+Math.random().toString(36).slice(2);
var target=window.open('about:blank','_blank');
if(!target){alert('浏览器阻止了新窗口。请允许此页面打开弹出窗口后重试。');return;}
var extractionReady=false;
var readyHandler=function(event){if(!extractionReady||event.source!==target||event.data?.src!=='lt-ready'||event.data?.handoffId!==handoffId)return;try{target.postMessage({src:'lt-bm',handoffId:handoffId,subtitles:pendingSubs||[]},app);if(window.console&&console.info)console.info('[youtube-import]',{source:'bookmarklet',extraction:pendingExtractor,subtitleCount:pendingSubs.length,videoId:vid,elapsedMs:Date.now()-startedAt,handoffWindowOpened:true,handoffReady:true,handoffTransferred:true});}catch(e){}};
var pendingSubs='';
var pendingExtractor='';
window.addEventListener('message',readyHandler);
setTimeout(function(){window.removeEventListener('message',readyHandler);},120000);
function fmt(s){s=Number(s)||0;var h=Math.floor(s/3600),m=Math.floor((s%3600)/60),x=(s%60).toFixed(3).padStart(6,'0');if(h>0)return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+x;return String(m).padStart(2,'0')+':'+x;}
function cleanLine(t){if(!t)return '';return String(t).replace(/<s\\b[^>]*>/gi,'s').replace(/<\\/s\\b[^>]*>/gi,'').replace(/<\\/?[a-z][^>]*>/gi,'').replace(/^\\s*(?:\\d+\\s*(?:分(?:鐘|钟)?|min(?:ute)?s?)\\s*(?:\\d+\\s*(?:秒(?:钟)?|sec(?:ond)?s?))?|\\d+\\s*(?:秒(?:钟)?|sec(?:ond)?s?))\\s*[-–—:♪♫♩♬\\s]*/i,'').replace(/\\s+/g,' ').trim();}
function parseTime(str){if(!str)return 0;var p=String(str).trim().split(':').map(function(n){return parseInt(n,10)||0;});if(p.length===3)return p[0]*3600+p[1]*60+p[2];if(p.length===2)return p[0]*60+p[1];return 0;}
function openStudy(subs,extractor){
pendingSubs=subs||[];
pendingExtractor=extractor||'none';
extractionReady=true;
var p=new URLSearchParams({bookmarklet:'1',url:u,title:t,videoId:vid,handoffId:handoffId});
try{target.location.replace(app+'/local-study?'+p.toString());}catch(e){showNote('无法打开 LingoClub，请检查弹出窗口设置。');}
}
function encode(lines){
if(!lines||!lines.length)return '';
var normalized=lines.map(function(line,index){
var start=Number(line.start);if(!Number.isFinite(start))start=parseTime(line.time_start||'');
var duration=Number(line.duration);if(!Number.isFinite(duration)||duration<=0){var next=lines[index+1];var nextStart=next?Number(next.start):NaN;if(!Number.isFinite(nextStart)&&next)nextStart=parseTime(next.time_start||'');duration=Number.isFinite(nextStart)&&nextStart>start?nextStart-start:2;}
return{text_en:cleanLine(line.text||line.text_en||''),time_start:fmt(start),time_end:fmt(start+duration)};
}).filter(function(line){return line.text_en;});
return normalized;
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
text=cleanLine(text);
if(!text)return;
var startMs=Number(cr.startMs||0);
var durMs=Number(cr.durationMs||0);
lines.push({start:startMs/1000,duration:durMs/1000,text:text});
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
if(text){text=cleanLine(text);if(text)lines.push({start:parseTime(timeStr),duration:0,text:text});}
});
return lines.length?lines:null;
}
function showNote(msg){
var d=document.getElementById('lt-note');
if(d)d.remove();
d=document.createElement('div');
d.id='lt-note';
d.style.cssText='position:fixed;top:20px;right:20px;z-index:999999;padding:14px 20px;border-radius:12px;background:#1a1a2e;color:#00e6b3;font:14px/1.5 system-ui,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,0.4);max-width:360px;transition:opacity 0.3s';
d.textContent=msg;
document.body.appendChild(d);
return d;
}
function openTranscriptPanel(){
var keywords=['transcript','转录','转写','文字稿','显示转写文稿','open transcript','show transcript'];
var els=document.querySelectorAll('button,yt-button-renderer,tp-yt-paper-button,ytd-button-renderer,ytd-menu-item-renderer,yt-button-shape button,a[role="menuitem"]');
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
var moreBtn=null;
var menuBtns=document.querySelectorAll('button[aria-label],ytd-button-renderer,yt-button-shape button,button');
for(var j=0;j<menuBtns.length;j++){
var mb=menuBtns[j];
var mbAria=(mb.getAttribute('aria-label')||'').toLowerCase();
var mbText=(mb.textContent||'').toLowerCase().trim();
if(mbAria.indexOf('more')>-1||mbAria.indexOf('更多')>-1||mbAria.indexOf('其他')>-1||mbText==='...'||mbText==='⋯'){
if(mb.offsetParent!==null){moreBtn=mb;break;}
}
}
if(moreBtn){
try{moreBtn.click();}catch(e){}
setTimeout(function(){
var menuItems=document.querySelectorAll('ytd-menu-service-item-renderer,tp-yt-paper-item,a[role="menuitem"],button[role="menuitem"],ytd-menu-item-renderer');
for(var m=0;m<menuItems.length;m++){
var mi=menuItems[m];
var miText=(mi.textContent||'').toLowerCase().trim();
var miAria=(mi.getAttribute('aria-label')||'').toLowerCase().trim();
for(var mk=0;mk<keywords.length;mk++){
if(miText.indexOf(keywords[mk])>-1||miAria.indexOf(keywords[mk])>-1){
try{mi.click();}catch(e){}
return;
}
}
}
},600);
return true;
}
return false;
}
function handleNoSubs(note){
if(note)note.remove();
openStudy('');
}
function fetchFromAPI(){
var pr=window.ytInitialPlayerResponse;
if(!pr||!pr.captions)return null;
var tracks;try{tracks=pr.captions.playerCaptionsTracklistRenderer.captionTracks||[];}catch(e){return null;}
if(!tracks.length)return null;
var english=tracks.filter(function(x){return x.languageCode&&x.languageCode.indexOf('en')===0;});
var track=english.find(function(x){return x.languageCode==='en'&&x.kind!=='asr';})||english.find(function(x){return x.languageCode==='en'&&x.kind==='asr';})||english.find(function(x){return x.kind!=='asr';})||english[0];
if(!track)return Promise.resolve([]);
var bu=(track.baseUrl||'').replace(/[?&]fmt=[^&]+/g,'');
if(!bu)return null;
var sep=bu.indexOf('?')>-1?'&':'?';
return fetch(bu+sep+'fmt=json3',{credentials:'include'}).then(function(r){
if(!r.ok)return '';
return r.text();
}).then(function(txt){
if(!txt||!txt.trim()||txt.trim().charAt(0)!=='{')return [];
try{
var data=JSON.parse(txt);
return (data.events||[]).filter(function(e){return e.segs;}).map(function(e){
var tx=cleanLine((e.segs||[]).map(function(sg){return sg.utf8||'';}).join('').replace(/\\n/g,' ').trim());
var st=e.tStartMs/1000;var du=(e.dDurationMs||0)/1000;
return{start:st,duration:du,text:tx};
}).filter(function(l){return l.text;});
}catch(e){return [];}
}).catch(function(){return [];});
}
if(isYoutube){
var polyLines=extractFromPolymer();
if(polyLines){openStudy(encode(polyLines),'polymer');return;}
var domLines=extractFromDOM();
if(domLines){openStudy(encode(domLines),'dom');return;}
var settled=false;
var note=showNote('正在提取字幕，请稍候…');
var apiP=fetchFromAPI();
if(apiP){
apiP.then(function(lines){
if(settled)return;
if(lines&&lines.length){settled=true;note.remove();openStudy(encode(lines),'player-response');}
});
}
openTranscriptPanel();
var attempts=0;
var maxAttempts=24;
var pollId=setInterval(function(){
if(settled){clearInterval(pollId);return;}
attempts++;
if(attempts%4===0){openTranscriptPanel();}
var l2=extractFromPolymer()||extractFromDOM();
if(l2){
settled=true;
clearInterval(pollId);
note.remove();
openStudy(encode(l2),'polymer/dom-poll');
}else if(attempts>=maxAttempts){
clearInterval(pollId);
if(!settled){settled=true;handleNoSubs(note);}
}
},500);
}else if(u.indexOf('bilibili.com/video')>-1){
openStudy('');
}else{alert('请在 YouTube 或 B站 视频页面点击此书签');}
})();`;
  return "javascript:" + encodeURIComponent(code);
}

export function StepBadge({ n, className = "" }) {
  return (
    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${className}`}>
      {n}
    </span>
  );
}

export function StepCard({ icon: Icon, title, desc }) {
  return (
    <div className="flex items-start gap-3.5 rounded-xl border border-white/8 bg-background-elev/40 p-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-mint text-background">
        <Icon size={17} />
      </div>
      <div className="flex-1">
        <h3 className="font-display text-sm font-semibold text-foreground">{title}</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{desc}</p>
      </div>
    </div>
  );
}

// 移动端教程：PWA 安装 + YouTube 导入指南
export function MobileTutorial() {
  const ua = typeof window !== "undefined" ? navigator.userAgent || "" : "";
  const isIOS = /iPhone|iPad|iPod/i.test(ua);

  const iosSteps = [
    { icon: Share, title: "点击底部「分享」", desc: "在 Safari 中打开本站，点击底部工具栏的分享按钮。" },
    { icon: Plus, title: "选择「添加到主屏幕」", desc: "在弹出的菜单中找到并点击「添加到主屏幕」。" },
    { icon: Smartphone, title: "像 App 一样使用", desc: "主屏幕出现 LingoClub 图标，点击即可全屏沉浸学习。" },
  ];
  const androidSteps = [
    { icon: Monitor, title: "点击浏览器菜单", desc: "在 Chrome 中打开本站，点击右上角三点菜单。" },
    { icon: Download, title: "选择「安装应用」", desc: "在菜单中找到「安装应用」或「添加到主屏幕」。" },
    { icon: Smartphone, title: "像 App 一样使用", desc: "桌面出现 LingoClub 图标，点击即可全屏沉浸学习。" },
  ];
  const pwaSteps = isIOS ? iosSteps : androidSteps;

  return (
    <div className="space-y-8">
      {/* 第一部分：添加到主屏幕 */}
      <section className="rounded-2xl border border-mint/25 bg-gradient-to-br from-card to-background-elev/50 p-6 md:p-8">
        <span className="inline-flex items-center gap-2 rounded-full border border-mint/50 bg-mint/10 px-3 py-1 text-[11px] uppercase tracking-luxe text-mint">
          <Smartphone size={12} /> 第一步 · 安装到主屏幕
        </span>
        <h2 className="mt-4 font-display text-lg text-foreground">把 LingoClub 装到手机</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          无需下载、无需应用商店。安装后全屏沉浸播放，像 App 一样独立运行。
        </p>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-mint/80">
          <Smartphone size={13} /> 当前设备：{isIOS ? "iPhone / iPad" : "Android"}
        </p>
        <div className="mt-5 space-y-3">
          {pwaSteps.map((s, i) => (
            <StepCard key={i} {...s} />
          ))}
        </div>
      </section>

      {/* 第二部分：导入 YouTube 视频 */}
      <section className="rounded-2xl border border-copper/25 bg-gradient-to-br from-card to-background-elev/50 p-6 md:p-8">
        <span className="inline-flex items-center gap-2 rounded-full border border-copper/50 bg-copper/10 px-3 py-1 text-[11px] uppercase tracking-luxe text-copper">
          <Youtube size={12} /> 第二步 · 导入 YouTube 视频
        </span>
        <h2 className="mt-4 font-display text-lg text-foreground">安装后如何导入视频</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          打开 App 后直接粘贴 YouTube 链接，标题、封面和字幕自动获取——无需书签、无需电脑。
        </p>
        <ol className="mt-5 space-y-3 text-sm leading-relaxed text-muted-foreground">
          <li className="flex gap-2.5">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-copper text-xs font-bold text-copper-foreground">1</span>
            <span>打开 YouTube App，找到你想学习的视频，点击「分享」→「复制链接」。</span>
          </li>
          <li className="flex gap-2.5">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-copper text-xs font-bold text-copper-foreground">2</span>
            <span>回到桌面，点击 LingoClub 图标打开 App。</span>
          </li>
          <li className="flex gap-2.5">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-copper text-xs font-bold text-copper-foreground">3</span>
            <span>进入「我的影片」→ 点击导入，在视频链接输入框中粘贴刚才复制的 YouTube 链接。</span>
          </li>
          <li className="flex gap-2.5">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-copper text-xs font-bold text-copper-foreground">4</span>
            <span>系统自动获取视频标题、封面和字幕（含时间戳），完成后点击「进入精读学习」即可开始。<Check size={14} className="text-copper" /></span>
          </li>
        </ol>
        <div className="mt-5 flex items-start gap-2 rounded-lg border border-copper/20 bg-copper/5 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          <Lightbulb size={14} className="mt-0.5 shrink-0 text-copper" />
          <span>如果自动获取字幕失败，可以在 YouTube 页面点击「更多」→「显示转录文字」→ 全选复制，然后回到 App 的「字幕管理」中粘贴即可。</span>
        </div>
      </section>
    </div>
  );
}

// 电脑端教程：书签一键导入
export function DesktopTutorial() {
  const [appUrl] = useState(() => import.meta.env.DEV && typeof window !== "undefined"
    ? window.location.origin
    : "https://lingoclub.vercel.app");
  const bookmarklet = useMemo(() => buildBookmarklet(appUrl), [appUrl]);

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-copper/25 bg-gradient-to-br from-card to-background-elev/50 p-6 md:p-8">
        <span className="inline-flex items-center gap-2 rounded-full border border-copper/50 bg-copper/10 px-3 py-1 text-[11px] uppercase tracking-luxe text-copper">
          <Bookmark size={12} /> 书签一键导入
        </span>
        <h2 className="mt-4 font-display text-lg text-foreground">拖动书签到浏览器书签栏</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          将下方按钮拖到书签栏，在 YouTube 视频页面点击即可导入学习。字幕在视频页面直接提取，学习页在新标签页打开，不离开当前 YouTube 页面。
        </p>

        {/* Step 1: 显示书签栏 */}
        <div className="mt-6">
          <h3 className="flex items-center gap-2.5 font-display text-sm text-foreground">
            <StepBadge n="1" className="bg-copper text-copper-foreground" />
            显示书签栏
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            按 <kbd className="rounded bg-background-elev px-2 py-0.5 text-xs text-copper">Ctrl + Shift + B</kbd>（Mac 按 <kbd className="rounded bg-background-elev px-2 py-0.5 text-xs text-copper">Cmd + Shift + B</kbd>）显示浏览器书签栏。
          </p>
        </div>

        {/* Step 2: 拖动按钮 */}
        <div className="mt-6">
          <h3 className="flex items-center gap-2.5 font-display text-sm text-foreground">
            <StepBadge n="2" className="bg-copper text-copper-foreground" />
            拖动按钮到书签栏
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">按住下方按钮，拖到浏览器书签栏后松手：</p>
          <div className="mt-4 flex justify-center">
            <a
              href={bookmarklet}
              draggable
              className="group inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-mint to-copper px-8 py-4 text-base font-bold text-background shadow-lg shadow-mint/20 transition-transform hover:scale-[1.03] active:scale-95 cursor-grab"
            >
              <Youtube size={20} /> 导入到 LingoClub
            </a>
          </div>
          <p className="mt-3 text-center text-xs text-muted-foreground/60">
            如果拖不动，可以右键按钮 →「复制链接地址」，然后手动添加书签。
          </p>
        </div>

        {/* Step 3: 使用 */}
        <div className="mt-6">
          <h3 className="flex items-center gap-2.5 font-display text-sm text-foreground">
            <StepBadge n="3" className="bg-copper text-copper-foreground" />
            开始使用
          </h3>
          <ol className="mt-3 space-y-2.5 text-sm leading-relaxed text-muted-foreground">
            <li className="flex gap-2"><span className="text-copper/70">①</span> 打开任意 YouTube 视频页面</li>
            <li className="flex gap-2"><span className="text-copper/70">②</span> 点击视频下方「···」→「显示转录」打开转录面板（可选，书签也会自动尝试打开）</li>
            <li className="flex gap-2"><span className="text-copper/70">③</span> 点击书签栏中的「导入到 LingoClub」，字幕从 Polymer 数据模型直接提取</li>
            <li className="flex gap-2"><span className="text-copper/70">④</span> 学习页在新标签页中打开，当前 YouTube 页面不受影响 <Check size={14} className="text-copper" /></li>
          </ol>
        </div>
      </section>

      {/* 使用说明 */}
      <div className="rounded-2xl border border-copper/30 bg-copper/5 p-5">
        <h3 className="flex items-center gap-2 font-display text-sm text-foreground">
          <Lightbulb size={15} className="text-copper" /> 使用说明
        </h3>
        <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
          <li>• YouTube 字幕优先从转录面板的 Polymer 数据模型直接提取（最可靠，不依赖 DOM 类名）</li>
          <li>• 兼容新旧 YouTube UI：自动适配 transcript-segment-view-model / ytd-transcript-segment-renderer 两种结构</li>
          <li>• 如果面板未打开，书签会自动点击「显示转录」按钮并等待重试</li>
          <li>• 学习页在新标签页打开，YouTube 页面保持不变，可继续观看</li>
          <li>• 导入的视频会保存到「我的影片」，可在任意设备打开播放</li>
          <li>• 如果视频没有英文字幕，可以在学习页用 OCR 扫描或手动添加</li>
        </ul>
      </div>
    </div>
  );
}
