// GET /c/:id: the family page. Someone opens the link from WhatsApp with no app, says when they
// are free this weekend (four chips, "not this weekend", their voice, or typing), and the page
// seals the answer in the browser with the circle key from #k=... before it is stored.
// The relay only ever sees ciphertext. One self-contained document, inline CSS and JS under a nonce.
import { CIRCLE_ID_RE } from '@kizuna/shared';
import { CSS, MARK, nonce } from './page.ts';

function familyHeaders(n: string): Record<string, string> {
	return {
		'content-type': 'text/html; charset=utf-8',
		'cache-control': 'no-store',
		'x-content-type-options': 'nosniff',
		'referrer-policy': 'no-referrer',
		'x-frame-options': 'DENY',
		'x-robots-tag': 'noindex, nofollow',
		'cross-origin-opener-policy': 'same-origin',
		'permissions-policy': 'microphone=(self), camera=(), geolocation=()',
		'content-security-policy': [
			"default-src 'none'",
			`style-src 'nonce-${n}'`,
			`script-src 'nonce-${n}'`,
			"connect-src 'self'",
			'img-src data:',
			"font-src 'self'",
			"form-action 'none'",
			"base-uri 'none'",
			"frame-ancestors 'none'"
		].join('; ')
	};
}

/**
 * The page's AES-GCM sealing, the same steps as shared/src/seal.ts (key = raw 32 bytes base64url,
 * 12-byte iv, AAD `kizuna:<circleId>:<memberId>`, JSON plaintext). Tests run this source against seal.ts.
 */
export const SEAL_JS = `
function b64url(bytes){var s='';for(var i=0;i<bytes.length;i++)s+=String.fromCharCode(bytes[i]);return btoa(s).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');}
function unb64url(t){var s=atob(t.replace(/-/g,'+').replace(/_/g,'/')+'==='.slice((t.length+3)%4));var b=new Uint8Array(s.length);for(var i=0;i<s.length;i++)b[i]=s.charCodeAt(i);return b;}
function aadFor(circleId,memberId){return new TextEncoder().encode('kizuna:'+circleId+':'+memberId);}
function importKey(key){return crypto.subtle.importKey('raw',unb64url(key),'AES-GCM',false,['encrypt','decrypt']);}
function randomId(n){return b64url(crypto.getRandomValues(new Uint8Array(Math.ceil(n*3/4)))).slice(0,n);}
async function keyOk(key){try{if(!/^[A-Za-z0-9_-]{43}$/.test(key)||unb64url(key).length!==32)return false;await importKey(key);return true;}catch(_){return false;}}
async function sealEntry(key,circleId,memberId,entry){
  var iv=crypto.getRandomValues(new Uint8Array(12));
  var ct=await crypto.subtle.encrypt({name:'AES-GCM',iv:iv,additionalData:aadFor(circleId,memberId)},await importKey(key),new TextEncoder().encode(JSON.stringify(entry)));
  return {iv:b64url(iv),ct:b64url(new Uint8Array(ct))};
}
async function openEntry(key,circleId,memberId,sealed){
  try{
    var pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64url(sealed.iv),additionalData:aadFor(circleId,memberId)},await importKey(key),unb64url(sealed.ct));
    var e=JSON.parse(new TextDecoder().decode(pt));
    return e&&e.v===1?e:null;
  }catch(_){return null;}
}
`;

/**
 * Pure time helpers, in the viewer's own time zone (the browser's). Morning 09:00 to 12:00,
 * evening 17:00 to 21:00; each chip is the next such window that hasn't ended, within 7 days.
 * Morning and evening of the same day merge, so four chips never make more than 3 windows.
 */
export const TIME_JS = `
var CHIPS={'sat-am':[6,9,12],'sat-pm':[6,17,21],'sun-am':[0,9,12],'sun-pm':[0,17,21]};
function p2(n){return (n<10?'0':'')+n;}
function isoLocal(d){var o=-d.getTimezoneOffset(),a=Math.abs(o);return d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate())+'T'+p2(d.getHours())+':'+p2(d.getMinutes())+':00'+(o<0?'-':'+')+p2(Math.floor(a/60))+':'+p2(a%60);}
function chipWindow(chip,now){
  var c=CHIPS[chip];if(!c)return null;
  for(var i=0;i<8;i++){
    var s=new Date(now.getFullYear(),now.getMonth(),now.getDate()+i,c[1],0,0);
    if(s.getDay()!==c[0])continue;
    var e=new Date(now.getFullYear(),now.getMonth(),now.getDate()+i,c[2],0,0);
    if(e<=now)continue;
    if(s.getTime()-now.getTime()>=7*864e5)return null;
    return {start:s,end:e};
  }
  return null;
}
function chipWindows(chips,now){
  var list=[];
  chips.forEach(function(ch){var w=chipWindow(ch,now);if(w)list.push(w);});
  list.sort(function(a,b){return a.start-b.start;});
  var out=[];
  list.forEach(function(w){
    var last=out[out.length-1];
    if(last&&last.start.toDateString()===w.start.toDateString())last.end=w.end>last.end?w.end:last.end;
    else out.push({start:w.start,end:w.end});
  });
  return out.slice(0,3).map(function(w){return {start:isoLocal(w.start),end:isoLocal(w.end)};});
}
function parsedWindows(out,now){
  var res=[];
  ((out&&out.windows)||[]).forEach(function(w){
    var d=/^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(w.day),a=/^(\\d{1,2}):(\\d{2})$/.exec(w.start),b=/^(\\d{1,2}):(\\d{2})$/.exec(w.end);
    if(!d||!a||!b)return;
    var s=new Date(+d[1],+d[2]-1,+d[3],+a[1],+a[2]),e=new Date(+d[1],+d[2]-1,+d[3],+b[1],+b[2]);
    if(e<=s||e<=now||s.getTime()-now.getTime()>=7*864e5)return;
    res.push({start:isoLocal(s),end:isoLocal(e)});
  });
  return res.slice(0,3);
}
`;

// The page itself. DOM text is only ever set with textContent.
const APP_JS = `
var $=function(id){return document.getElementById(id);};
var circleId=document.body.getAttribute('data-circle');
var tz='';try{tz=Intl.DateTimeFormat().resolvedOptions().timeZone||'';}catch(_){}
var hash=new URLSearchParams(location.hash.replace(/^#/,''));
var key=hash.get('k')||'';
var from=(hash.get('from')||'').replace(/[\\u0000-\\u001f]/g,'').trim().slice(0,40);
var store={};var storeKey='kizuna:c:'+circleId;
try{store=JSON.parse(localStorage.getItem(storeKey)||'{}')||{};}catch(_){store={};}
function save(){try{localStorage.setItem(storeKey,JSON.stringify(store));}catch(_){}}
var memberId=/^[A-Za-z0-9_-]{12}$/.test(store.memberId||'')?store.memberId:randomId(12);
var members=[];var picked=[];var pending=null;
function show(id){['s-ask','s-thanks','s-incomplete','s-ended','s-wait'].forEach(function(s){$(s).hidden=s!==id;});window.scrollTo(0,0);}
function err(t){$('err').textContent=t||'';}
var dayFmt,hmFmt;
try{dayFmt=new Intl.DateTimeFormat(undefined,{weekday:'short',day:'numeric',month:'short'});hmFmt=new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'});}catch(_){}
function label(w){var s=new Date(w.start),e=new Date(w.end);return dayFmt?dayFmt.format(s)+', '+hmFmt.format(s)+' to '+hmFmt.format(e):w.start;}

async function load(){
  if(!circleId||!(await keyOk(key))){show('s-incomplete');return;}
  if(from){$('title').textContent=from+' is planning a family call.';$('title-hi').textContent=from+' परिवार के साथ कॉल रख रहे हैं।';}
  if(store.name)$('name').value=store.name;
  var now=new Date();
  document.querySelectorAll('[data-chip]').forEach(function(b){
    var w=chipWindow(b.getAttribute('data-chip'),now);
    var when=b.querySelector('.when');
    if(!w){b.disabled=true;if(when)when.textContent='Passed';return;}
    if(when&&dayFmt)when.textContent=dayFmt.format(w.start);
    b.addEventListener('click',function(){
      var c=b.getAttribute('data-chip'),i=picked.indexOf(c);
      if(i>=0)picked.splice(i,1);else picked.push(c);
      b.setAttribute('aria-pressed',i>=0?'false':'true');
      $('send').disabled=picked.length===0;err('');
    });
  });
  if(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia&&(window.AudioContext||window.webkitAudioContext))$('mic').hidden=false;
  else $('typed').hidden=false;
  try{
    var r=await fetch('/api/circle/'+encodeURIComponent(circleId),{headers:{accept:'application/json'},cache:'no-store',referrerPolicy:'no-referrer'});
    if(r.status===404){show('s-ended');return;}
    if(r.ok){var j=await r.json();members=(j&&j.members)||[];}
  }catch(_){}
  if(store.answered)$('again-note').hidden=false;
  show('s-ask');
}

async function submit(windows,notThisWeekend){
  err('');
  var name=$('name').value.replace(/\\s+/g,' ').trim().slice(0,40);
  store.name=name;store.memberId=memberId;save();
  var entry={v:1,name:name,tz:tz||'UTC',status:null,statusUntil:null,windows:windows.slice(0,3),via:'page',updatedAt:new Date().toISOString()};
  if(notThisWeekend)entry.notThisWeekend=true;
  setBusy(true);
  try{
    var sealed=await sealEntry(key,circleId,memberId,entry);
    var r=await fetch('/api/circle/'+encodeURIComponent(circleId)+'/m/'+memberId,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(sealed),referrerPolicy:'no-referrer'});
    if(r.status===404){show('s-ended');return;}
    if(!r.ok)throw new Error('save');
    store.answered=true;save();
    await thanks(name,notThisWeekend);
  }catch(_){err('That did not go through. Please try again in a moment. / भेजा नहीं जा सका, थोड़ी देर में फिर कोशिश करें।');}
  finally{setBusy(false);}
}
function setBusy(b){['send','nope','sendheard','read','mic'].forEach(function(id){var el=$(id);if(el)el.disabled=b||(id==='send'&&picked.length===0);});}

async function thanks(name,nope){
  $('thanks-title').textContent=name?'Thank you, '+name+'.':'Thank you.';
  $('thanks-sub').textContent=nope?'No problem. Maybe next time.':(from?from+' will see when you are free.':'Your family will see when you are free.');
  var names=[];
  for(var i=0;i<members.length;i++){
    var m=members[i];if(m.memberId===memberId)continue;
    var e=await openEntry(key,circleId,m.memberId,m);
    if(e&&e.name&&names.indexOf(e.name)<0)names.push(String(e.name).slice(0,40));
  }
  $('others').textContent=names.length?'Also answered: '+names.join(', ')+'.':'';
  show('s-thanks');
}

async function readReply(text,heard){
  err('');$('heard').hidden=true;
  try{
    var r=await fetch('/api/spark',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({task:'windows',input:{reply:text.slice(0,500),now:isoLocal(new Date()),timeZone:tz||'UTC'}}),referrerPolicy:'no-referrer'});
    var j=await r.json();
    if(!j||!j.ok)throw new Error('spark');
    var ws=parsedWindows(j.output,new Date());
    var nope=!!(j.output&&j.output.not_this_weekend)&&ws.length===0;
    if(!ws.length&&!nope){err('We could not find a time in that. Please tap the times above, or type it. / समय समझ नहीं आया, ऊपर से चुनें या लिखें।');$('typed').hidden=false;return;}
    pending={windows:ws,nope:nope};
    $('heardtext').textContent=heard?'"'+text+'"':'';
    var ul=$('heardlist');ul.textContent='';
    if(nope){var li=document.createElement('li');li.textContent='Not this weekend';ul.appendChild(li);}
    ws.forEach(function(w){var li=document.createElement('li');li.textContent=label(w);ul.appendChild(li);});
    $('heard').hidden=false;$('heard').scrollIntoView({behavior:'smooth',block:'center'});
  }catch(_){err('Sorry, that did not work. Please tap the times above, or type it. / माफ़ कीजिए, ऊपर से चुनें या लिखें।');$('typed').hidden=false;}
}

// Voice: record PCM through Web Audio, make a 16 kHz mono 16-bit WAV, transcribe, then read it.
var rec=null;
function wav(chunks,rate){
  var len=0;chunks.forEach(function(c){len+=c.length;});
  var all=new Float32Array(len),at=0;chunks.forEach(function(c){all.set(c,at);at+=c.length;});
  var ratio=rate/16000,n=Math.floor(len/ratio),pcm=new Int16Array(n);
  for(var i=0;i<n;i++){var a=Math.floor(i*ratio),b=Math.max(a+1,Math.floor((i+1)*ratio)),s=0;for(var j=a;j<b&&j<len;j++)s+=all[j];s/=(b-a);s=Math.max(-1,Math.min(1,s));pcm[i]=s<0?s*32768:s*32767;}
  var buf=new ArrayBuffer(44+n*2),v=new DataView(buf);
  function str(o,t){for(var k=0;k<t.length;k++)v.setUint8(o+k,t.charCodeAt(k));}
  str(0,'RIFF');v.setUint32(4,36+n*2,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);
  v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,n*2,true);
  new Int16Array(buf,44).set(pcm);
  return new Blob([buf],{type:'audio/wav'});
}
async function startRec(){
  err('');
  try{
    var stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true}});
    var Ctx=window.AudioContext||window.webkitAudioContext,ctx=new Ctx();
    var src=ctx.createMediaStreamSource(stream),proc=ctx.createScriptProcessor(4096,1,1),chunks=[];
    proc.onaudioprocess=function(e){chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));};
    src.connect(proc);proc.connect(ctx.destination);
    rec={stream:stream,ctx:ctx,proc:proc,src:src,chunks:chunks,timer:setTimeout(stopRec,30000)};
    $('mic-label').textContent='Listening. Tap to stop';$('mic-hi').textContent='सुन रहे हैं, रोकने के लिए दबाएँ';
    $('mic').setAttribute('aria-pressed','true');
  }catch(_){micFailed();}
}
async function stopRec(){
  if(!rec)return;var r=rec;rec=null;clearTimeout(r.timer);
  try{r.proc.disconnect();r.src.disconnect();}catch(_){}
  r.stream.getTracks().forEach(function(t){t.stop();});
  var rate=r.ctx.sampleRate;try{r.ctx.close();}catch(_){}
  resetMic();$('micstatus').textContent='One moment… / एक पल…';
  try{
    if(!r.chunks.length)throw new Error('empty');
    var res=await fetch('/api/transcribe?lang=hi,en&session='+randomId(12),{method:'POST',headers:{'content-type':'audio/wav'},body:wav(r.chunks,rate),referrerPolicy:'no-referrer'});
    var j=await res.json();
    var text=j&&j.ok&&typeof j.text==='string'?j.text.trim():'';
    $('micstatus').textContent='';
    if(!text)throw new Error('no text');
    $('reply').value=text;
    await readReply(text,true);
  }catch(_){$('micstatus').textContent='';micFailed();}
}
function resetMic(){$('mic-label').textContent='Speak instead';$('mic-hi').textContent='बोलकर बताइए';$('mic').setAttribute('aria-pressed','false');}
function micFailed(){resetMic();$('typed').hidden=false;err('The microphone did not work. Please type it instead. / माइक नहीं चला, लिखकर बताइए।');}

$('send').addEventListener('click',function(){var now=new Date();submit(chipWindows(picked,now),false);});
$('nope').addEventListener('click',function(){submit([],true);});
$('mic').addEventListener('click',function(){if(rec)stopRec();else startRec();});
$('typeopen').addEventListener('click',function(){$('typed').hidden=false;$('reply').focus();});
$('read').addEventListener('click',function(){var t=$('reply').value.trim();if(t)readReply(t,false);});
$('sendheard').addEventListener('click',function(){if(pending)submit(pending.windows,pending.nope);});
$('again').addEventListener('click',function(){show('s-ask');});
load();
`;

const FAMILY_CSS = `
h1{font-size:36px}
.hi{display:block;color:var(--muted);font-size:.86em;font-weight:400;letter-spacing:0;margin-top:2px}
.sub .hi{font-size:17px}
.chips{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0 0 22px}
.chip{display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:2px;min-height:96px;padding:14px 16px;border-radius:20px;border:0;box-shadow:var(--card);background:var(--surface);color:var(--text);font:inherit;font-size:20px;font-weight:500;letter-spacing:-.015em;text-align:left;cursor:pointer;transition:background .15s,color .15s,box-shadow .15s}
.chip .hi{font-size:16px}
.chip .when{font-size:13px;font-weight:400;color:var(--faint);margin-top:4px}
.chip[aria-pressed="true"]{background:var(--accent);color:var(--on-accent);box-shadow:0 10px 22px -14px var(--accent)}
.chip[aria-pressed="true"] .hi,.chip[aria-pressed="true"] .when{color:var(--on-accent);opacity:.85}
.chip[disabled]{opacity:.45;cursor:default}
.chip:focus-visible,.btn:focus-visible,.link:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.field{display:block;margin:0 0 18px;font-size:15px;color:var(--muted)}
.field>span{display:block;margin-bottom:6px}
.field .hi{display:inline;margin-left:6px}
input,textarea{width:100%;font:inherit;font-size:19px;color:var(--text);background:var(--surface);border:0;box-shadow:inset 0 0 0 1px var(--line);border-radius:14px;padding:14px 16px;min-height:56px}
textarea{resize:vertical}
input:focus,textarea:focus{outline:none;box-shadow:inset 0 0 0 1px var(--accent),0 0 0 4px var(--accent-soft)}
.stack{display:grid;gap:10px}
button.btn{width:100%;border:0;font:inherit;font-weight:500;cursor:pointer;min-height:60px;font-size:18px;gap:8px;flex-wrap:wrap}
button.btn .hi{display:inline;color:inherit;opacity:.8;font-size:15px;margin:0}
button.btn.secondary{background:var(--surface)}
button.btn[disabled]{opacity:.45;cursor:default}
.or{display:flex;align-items:center;gap:12px;color:var(--faint);font-size:13px;letter-spacing:.16em;text-transform:uppercase;margin:28px 0 14px}
.or::before,.or::after{content:"";flex:1;border-top:1px solid var(--line)}
.link{background:none;border:0;font:inherit;color:var(--muted);text-decoration:underline;text-underline-offset:3px;min-height:48px;padding:0;cursor:pointer;font-size:16px}
.link .hi{display:inline;margin-left:6px;font-size:15px}
.mic[aria-pressed="true"]{box-shadow:inset 0 0 0 2px var(--accent);color:var(--accent)}
.status{min-height:1.5em;color:var(--muted);margin:8px 0 0;font-size:15px}
.err{color:var(--danger);font-size:15px;margin:14px 0 0;min-height:1em}
.heard{margin:22px 0 0;padding:18px;border-radius:20px;background:var(--surface);box-shadow:var(--card)}
.heard .quote{color:var(--muted);margin:0 0 8px}
.times{list-style:none;margin:0 0 16px;padding:0;font-size:20px;font-variant-numeric:tabular-nums}
.times li{padding:8px 0;border-bottom:1px solid var(--line)}
.note{color:var(--faint);font-size:14px;margin:18px 0 0}
#again-note{color:var(--muted);font-size:15px;margin:-18px 0 22px}
`;

function body(): string {
	const chip = (id: string, en: string, hi: string) =>
		`<button type="button" class="chip" data-chip="${id}" aria-pressed="false"><span>${en}</span><span class="hi" lang="hi">${hi}</span><span class="when"></span></button>`;
	return `<section id="s-wait"><p class="sub">One moment… <span class="hi" lang="hi">एक पल…</span></p></section>
<section id="s-ask" hidden>
<p class="eyebrow">Family call <span lang="hi">· परिवार कॉल</span></p>
<h1><span id="title">A family call is being planned.</span><span class="hi" lang="hi" id="title-hi">परिवार के साथ कॉल की तैयारी है।</span></h1>
<p class="sub">When are you free this weekend?<span class="hi" lang="hi">इस वीकेंड आप कब फ़्री हैं?</span></p>
<p id="again-note" hidden>You answered before. Answering again replaces it.</p>
<div class="chips" role="group" aria-label="Times this weekend">
${chip('sat-am', 'Sat morning', 'शनिवार सुबह')}
${chip('sat-pm', 'Sat evening', 'शनिवार शाम')}
${chip('sun-am', 'Sun morning', 'रविवार सुबह')}
${chip('sun-pm', 'Sun evening', 'रविवार शाम')}
</div>
<label class="field"><span>Your name (optional) <span class="hi" lang="hi">आपका नाम</span></span><input id="name" maxlength="40" autocomplete="given-name" enterkeyhint="done"></label>
<div class="stack">
<button class="btn primary" id="send" type="button" disabled>Send <span class="hi" lang="hi">भेजें</span></button>
<button class="btn secondary" id="nope" type="button">Not this weekend <span class="hi" lang="hi">इस वीकेंड नहीं</span></button>
</div>
<div class="or">or</div>
<div class="stack">
<button class="btn secondary mic" id="mic" type="button" aria-pressed="false" hidden><span id="mic-label">Speak instead</span> <span class="hi" lang="hi" id="mic-hi">बोलकर बताइए</span></button>
</div>
<p class="status" id="micstatus" aria-live="polite"></p>
<button class="link" id="typeopen" type="button">or type it <span class="hi" lang="hi">या लिखकर बताइए</span></button>
<div id="typed" hidden>
<label class="field"><span>When are you free? <span class="hi" lang="hi">कब फ़्री हैं?</span></span><textarea id="reply" maxlength="500" rows="3" placeholder="Sunday shaam ko free hoon"></textarea></label>
<button class="btn secondary" id="read" type="button">Use this <span class="hi" lang="hi">यही भेजें</span></button>
</div>
<div class="heard" id="heard" hidden>
<p class="eyebrow">We understood <span lang="hi">· हमने समझा</span></p>
<p class="quote" id="heardtext"></p>
<ul class="times" id="heardlist"></ul>
<button class="btn primary" id="sendheard" type="button">Yes, send <span class="hi" lang="hi">हाँ, भेजें</span></button>
</div>
<p class="err" id="err" role="alert"></p>
<p class="note">Only your family circle can read your answer. Times only, never your location.</p>
</section>
<section id="s-thanks" hidden>
<p class="eyebrow">Sent <span lang="hi">· भेज दिया</span></p>
<h1><span id="thanks-title">Thank you.</span><span class="hi" lang="hi">धन्यवाद।</span></h1>
<p class="sub" id="thanks-sub"></p>
<p class="sub" id="others"></p>
<button class="link" id="again" type="button">Change my answer <span class="hi" lang="hi">जवाब बदलें</span></button>
</section>
<section id="s-incomplete" hidden>
<p class="eyebrow">Family call</p>
<h1>This link is incomplete.<span class="hi" lang="hi">यह लिंक अधूरा है।</span></h1>
<p class="sub">Ask for a new one.<span class="hi" lang="hi">नया लिंक माँग लीजिए।</span></p>
</section>
<section id="s-ended" hidden>
<p class="eyebrow">Family call</p>
<h1>This link has ended.<span class="hi" lang="hi">यह लिंक अब नहीं चलता।</span></h1>
<p class="sub">Ask for a new one.<span class="hi" lang="hi">नया लिंक माँग लीजिए।</span></p>
</section>
<noscript><p class="sub">Please open this link in a browser with JavaScript on. Your answer is locked on your phone before it is sent.</p></noscript>`;
}

export function renderFamilyPage(circleId: string): Response {
	const n = nonce();
	// An id that can't be a circle still gets the page, which then says the link is incomplete.
	const id = CIRCLE_ID_RE.test(circleId) ? circleId : '';
	const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#F7F3EA" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#161514" media="(prefers-color-scheme: dark)">
<title>Family call</title>
<style nonce="${n}">${CSS}${FAMILY_CSS}</style>
</head>
<body data-circle="${id}">
<main>
<div class="brand">${MARK}<span>Kizuna</span></div>
${body()}
<footer>Sent with <b>Kizuna</b>. No app needed.</footer>
</main>
<script nonce="${n}">(function(){${SEAL_JS}${TIME_JS}${APP_JS}})();</script>
</body>
</html>`;
	return new Response(html, { status: 200, headers: familyHeaders(n) });
}

export async function handleFamilyPage(req: Request, circleId: string): Promise<Response> {
	if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
	return renderFamilyPage(circleId);
}
