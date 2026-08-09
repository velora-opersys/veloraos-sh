(function(){
'use strict';

function escapeHtml(value){
  return String(value==null?'':value).replace(/[&<>"']/g,function(char){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char];
  });
}
function $(selector){return document.querySelector(selector);}
function humanError(value){
  if(!value)return 'Unknown error';
  if(typeof value==='string')return value;
  if(Array.isArray(value))return value.map(humanError).join(', ');
  if(value.detail)return humanError(value.detail);
  if(value.error)return humanError(value.error);
  if(value.message)return humanError(value.message);
  try{return JSON.stringify(value);}catch(_){return String(value);}
}
function fatal(message){
  var app=document.getElementById('app');
  if(app){
    app.innerHTML='<div class="shell"><main class="main"><div class="fatal"><h2>VeloraOS UI error</h2><p>'+escapeHtml(String(message))+'</p><p class="muted">Open /api/health to check the backend.</p></div></main></div>';
  }
}
window.addEventListener('error',function(event){fatal(event.message||event.error||'Unknown JavaScript error');});
window.addEventListener('unhandledrejection',function(event){
  var reason=event.reason;
  if(reason&&reason.status===401){showLogin('Your session expired. Please sign in again.');return;}
  fatal((reason&&reason.message)||reason||'Unhandled promise rejection');
});
window.addEventListener('keydown',function(event){
  if(!S||!S.updateModal)return;
  if(event.key==='Escape'){event.preventDefault();closeUpdateModal();return;}
  if(event.key==='Tab'){
    var modal=document.querySelector('.confirm-modal');if(!modal)return;
    var focusable=modal.querySelectorAll('button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])');
    if(!focusable.length)return;
    var first=focusable[0],last=focusable[focusable.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  }
});

function ApiError(message,status,data){this.name='ApiError';this.message=message;this.status=status;this.data=data;}
ApiError.prototype=Object.create(Error.prototype);
ApiError.prototype.constructor=ApiError;

var API={
  request:async function(method,url,body,signal){
    var options={method:method,cache:'no-store',credentials:'same-origin',headers:{},signal:signal};
    if(body!==undefined){options.headers['Content-Type']='application/json';options.body=JSON.stringify(body);}
    if(method!=='GET'&&S&&S.csrf)options.headers['X-CSRF-Token']=S.csrf;
    var response=await fetch(url,options);
    var text=await response.text();
    var data;
    try{data=text?JSON.parse(text):{};}catch(_){data={detail:text};}
    if(!response.ok)throw new ApiError(humanError(data)||('HTTP '+response.status),response.status,data);
    return data;
  },
  get:function(url){return this.request('GET',url);},
  post:function(url,body,signal){return this.request('POST',url,body||{},signal);},
  patch:function(url,body){return this.request('PATCH',url,body||{});},
  del:function(url){return this.request('DELETE',url);}
};

var icons={
  chat:'<svg viewBox="0 0 24 24"><path d="M7.2 18.2 3.5 21V6.6A3.1 3.1 0 0 1 6.6 3.5h10.8a3.1 3.1 0 0 1 3.1 3.1v7.8a3.1 3.1 0 0 1-3.1 3.1H8.1c-.32 0-.63.1-.9.3Z"/><path d="M8 9h8"/><path d="M8 13h5.8"/></svg>',
  image:'<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="3.2"/><circle cx="9" cy="10" r="1.7"/><path d="m6.5 17 5.1-5.1a2 2 0 0 1 2.8 0L20 17"/></svg>',
  video:'<svg viewBox="0 0 24 24"><rect x="3.5" y="6" width="12.5" height="12" rx="3.2"/><path d="m16 10.2 4.7-2.5v8.6L16 13.8Z"/></svg>',
  settings:'<svg viewBox="0 0 24 24"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.09a2 2 0 0 1 1 1.74v.5a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z"/><circle cx="12" cy="12" r="3"/></svg>'
};

var S={
  page:'home',system:null,models:[],selected:'smollm2-360m',menu:false,msgs:[],chats:[],active:null,
  busy:false,error:'',search:'',pendingImages:[],user:null,settings:{},accounts:[],pendingAvatar:null,controller:null,stopRequested:false,reasoning:2,reasoningOpen:false,csrf:'',license:null,licenseBusy:false,showLicenseKey:false,update:null,updateBusy:false,updateModal:false,updatePoll:null,updateAnnounced:'',setup:null,setupStep:1,setupBusy:false,setupDownload:null,setupDeviceDraft:null,
  diagnostics:null,diagnosticsBusy:false,diagnosticsTest:null,editingIndex:null,editingDraft:'',chatNotice:''
};

function initial(user){
  var name=(user&&user.display_name)||'U';
  return String(name).trim().charAt(0).toUpperCase()||'U';
}
function avatarHtml(user,className){
  var cls=className||'user-avatar';
  if(user&&user.avatar){return '<span class="'+cls+'"><img src="'+escapeHtml(user.avatar)+'" alt=""></span>';}
  return '<span class="'+cls+' avatar-fallback">'+escapeHtml(initial(user))+'</span>';
}
function chatAvatar(role){
  if(role==='user')return avatarHtml(S.user,'avatar user profile-message-avatar');
  return '<span class="avatar assistant">V</span>';
}
function localChatKey(){return 'velora_chats_'+(S.user?S.user.id:'guest');}

function applyPersonalisation(){
  var accent=String(S.settings.accent||'');
  if(/^#[0-9a-f]{6}$/i.test(accent))document.documentElement.style.setProperty('--accent',accent);
  else document.documentElement.style.removeProperty('--accent');
  var background=String(S.settings.background||'').trim();
  if(background){
    document.body.style.backgroundImage='linear-gradient(180deg,rgba(3,6,17,.18),rgba(3,6,17,.52)),url('+JSON.stringify(background)+')';
    document.body.style.backgroundPosition='center center';
    document.body.style.backgroundSize='cover';
    document.body.style.backgroundAttachment='fixed';
  }else{
    document.body.style.backgroundImage='';
    document.body.style.backgroundPosition='';
    document.body.style.backgroundSize='';
    document.body.style.backgroundAttachment='';
  }
  var favicon=$('#favicon-link');
  if(favicon)favicon.href=String(S.settings.favicon||'').trim()||'/static/velora-favicon.png';
}

async function migrateBrowserPersonalisation(){
  if(!S.user||S.user.id!=='admin'||S.settings.browser_personalisation_migrated)return;
  var changed=false;
  var settings=Object.assign({},S.settings);
  var oldAccent=localStorage.getItem('velora_accent');
  var oldBackground=localStorage.getItem('velora_bg');
  var oldFavicon=localStorage.getItem('velora_favicon');
  if(!settings.accent&&oldAccent){settings.accent=oldAccent;changed=true;}
  if(!settings.background&&oldBackground){settings.background=oldBackground;changed=true;}
  if(!settings.favicon&&oldFavicon){settings.favicon=oldFavicon;changed=true;}
  settings.browser_personalisation_migrated=true;
  S.settings=settings;
  try{await API.post('/api/settings',{settings:settings});}catch(_){if(!changed)return;}
}

async function loadSettings(){
  try{S.settings=await API.get('/api/settings')||{};}catch(error){if(error.status===401)throw error;S.settings={};}
  await migrateBrowserPersonalisation();
  S.reasoning=clampReasoning(S.settings.cosmic_reasoning||2);
  applyPersonalisation();
}

async function loadLicense(){
  try{S.license=await API.get('/api/license/status');}
  catch(error){if(error.status===401)throw error;S.license={configured:false,activated:false,status:'error',connectionState:'error',message:humanError(error)};}
}

async function loadSetupStatus(){
  if(!S.user||S.user.role!=='admin'){S.setup=null;return null;}
  try{S.setup=await API.get('/api/setup/status');return S.setup;}
  catch(error){if(error.status===401)throw error;S.setup={completed:true,required:false,blockers:[],warnings:[],error:humanError(error)};return S.setup;}
}
async function loadSetupCore(){
  try{S.system=await API.get('/api/system');}catch(error){S.system={error:humanError(error)};}
  try{var payload=await API.get('/api/models');S.models=payload.models||payload||[];}catch(error){S.models=[];}
}

function updateIsRunning(){return !!(S.update&&['checking','downloading','installing'].indexOf(S.update.state)>=0);}
function updateDismissKey(){return 'velora_update_dismissed_'+String((S.update&&S.update.latestVersion)||'none');}
function updateIsDismissed(){return !!(S.update&&S.update.updateAvailable&&localStorage.getItem(updateDismissKey())==='1');}
function announceUpdate(text){var live=document.getElementById('update-live');if(live)live.textContent=text||'';}
async function loadUpdateStatus(){
  if(!S.user||S.user.role!=='admin'){S.update=null;return null;}
  try{
    S.update=await API.get('/api/update/status');
    if(S.update&&S.update.updateAvailable&&S.updateAnnounced!==S.update.latestVersion){S.updateAnnounced=S.update.latestVersion;announceUpdate('VeloraOS '+S.update.latestVersion+' is available.');}
    return S.update;
  }catch(error){if(error.status===401)throw error;S.update={state:'failed',error:humanError(error),message:humanError(error),updateAvailable:false,releaseNotes:[]};return S.update;}
}
function startUpdatePolling(){
  if(S.updatePoll)clearInterval(S.updatePoll);
  if(!S.user||S.user.role!=='admin')return;
  S.updatePoll=setInterval(async function(){
    var previous=S.update&&S.update.state;
    await loadUpdateStatus();
    if(S.page==='updates'||(S.update&&S.update.updateAvailable&&!updateIsDismissed())||previous!==(S.update&&S.update.state))render();
  },updateIsRunning()?4000:30000);
}
function stopUpdatePolling(){if(S.updatePoll){clearInterval(S.updatePoll);S.updatePoll=null;}}


async function loadCore(){
  try{S.system=await API.get('/api/system');}catch(error){if(error.status===401)throw error;S.system={error:humanError(error)};}
  try{var models=await API.get('/api/models');S.models=models.models||models||[];}catch(error){if(error.status===401)throw error;S.models=[];}
  try{
    var chats=await API.get('/api/chats');
    S.chats=chats.chats||chats||[];
    if(!S.chats.length&&S.user&&S.user.id==='admin'){
      try{
        var old=JSON.parse(localStorage.getItem('velora_chats')||'[]');
        if(Array.isArray(old)&&old.length){S.chats=old;await API.post('/api/chats',{chats:S.chats});}
      }catch(_){ }
    }
  }catch(error){
    if(error.status===401)throw error;
    try{S.chats=JSON.parse(localStorage.getItem(localChatKey())||'[]');}catch(_){S.chats=[];}
  }
}

function status(){return (S.system&&S.system.acceleration)||(S.system&&S.system.gpu&&S.system.gpu.acceleration)||'Trusted LAN';}
function top(){
  var maximum=S.page==='chat'&&clampReasoning(S.reasoning)===5;
  var updateBadge=S.user&&S.user.role==='admin'&&S.update&&S.update.updateAvailable?'<span class="nav-badge" aria-label="Update available">1</span>':'';
  var updateButton=S.user&&S.user.role==='admin'?'<button class="nav-update '+(S.page==='updates'?'active':'')+'" onclick="Velora.go(\'updates\')">Updates'+updateBadge+'</button>':'';
  return '<div class="top'+(maximum?' cosmic-maximum':'')+'"><div class="brand"><div class="logo">V</div><div><h1>VeloraOS</h1><p>'+escapeHtml((S.user&&S.user.display_name)||'User')+'\'s local AI appliance</p></div></div><div id="cosmic-header-badge" class="cosmic-header-badge" '+(maximum?'':'hidden')+'><span>✦</span> Maximum Power</div><div class="nav"><button class="'+(S.page==='home'?'active':'')+'" onclick="Velora.go(\'home\')">Home</button><button class="'+(S.page==='models'?'active':'')+'" onclick="Velora.go(\'models\')">Models</button><button class="'+(S.page==='diagnostics'?'active':'')+'" onclick="Velora.go(\'diagnostics\')">Diagnostics</button>'+updateButton+'<button class="'+(S.page==='upgrades'?'active':'')+'" onclick="Velora.go(\'upgrades\')">Upgrades</button><span class="pill"><span class="dot"></span>'+escapeHtml(status())+'</span><button class="top-profile" onclick="Velora.go(\'settings\')">'+avatarHtml(S.user,'top-avatar')+'<span>'+escapeHtml((S.user&&S.user.display_name)||'Profile')+'</span></button><button onclick="Velora.logout()">Logout</button></div></div>';
}
function shell(content){return '<div class="shell">'+top()+'<main class="main">'+content+'</main></div>';}
async function go(page){
  if(S.setup&&S.setup.required&&page!=='setup')return;
  S.page=page;S.error='';
  if(page==='settings'){await loadLicense();if(S.user&&S.user.role==='admin')await loadAccounts();}
  if(page==='diagnostics')await loadDiagnostics();
  if(page==='updates'&&S.user&&S.user.role==='admin')await loadUpdateStatus();
  render();
}
function render(){
  var app=$('#app');if(!app)return;
  if(!S.user){showLogin();return;}
  if(S.page==='setup'&&S.user&&S.user.role==='admin'){app.innerHTML=setupPage();afterSetupRender();return;}
  if(S.page==='chat'){app.innerHTML=chatPage();afterChat();return;}
  if(S.page==='models'){app.innerHTML=shell(modelsPage());return;}
  if(S.page==='diagnostics'){app.innerHTML=shell(diagnosticsPage());return;}
  if(S.page==='image'){app.innerHTML=shell(studioPage('Image Studio','Create images when a supported GPU and engine bundle are available.','Image generation engine is staged for the managed ComfyUI bundle.'));return;}
  if(S.page==='video'){app.innerHTML=shell(studioPage('Video Studio','Create short local AI videos on supported hardware.','Video generation engine is staged for the managed workflow bundle.'));return;}
  if(S.page==='settings'){app.innerHTML=shell(settingsPage());return;}
  if(S.page==='updates'&&S.user&&S.user.role==='admin'){app.innerHTML=shell(updatesPage()+updateModalHtml());afterUpdateRender();return;}
  if(S.page==='upgrades'){app.innerHTML=shell(upgradesPage());return;}
  app.innerHTML=shell(homePage());
}
function updateNotificationHtml(){
  if(!S.user||S.user.role!=='admin'||!S.update||!S.update.updateAvailable||updateIsDismissed())return '';
  return '<section class="update-notice" role="status"><div><span class="tag">Update available</span><h3>'+escapeHtml(S.update.title||('VeloraOS '+S.update.latestVersion))+'</h3><p>'+escapeHtml((S.update.releaseNotes&&S.update.releaseNotes[0])||'A newer VeloraOS release is ready to review.')+'</p></div><div class="update-notice-actions"><button class="btn" onclick="Velora.go(\'updates\')">View update</button><button class="icon-button" onclick="Velora.dismissUpdateNotice()" aria-label="Dismiss update notification" title="Dismiss">×</button></div></section>';
}
function homePage(){
  return updateNotificationHtml()+'<section class="hero"><p class="eyebrow">VeloraOS V1</p><h2>Private AI, simply managed.</h2><p class="lead">Choose an app. Every workspace is fully custom-built for VeloraOS, bringing Chat, Image and Video together in one private local AI experience.</p></section><section class="apps">'+appCard('chat','Chat','Talk to installed local models with saved chats and a proper workspace.')+appCard('image','Image Studio','Create images when a supported GPU and engine bundle are available.')+appCard('video','Video Studio','Create short local AI videos on supported hardware.')+appCard('settings','Settings','Accounts, profile pictures, personalisation and system details.')+'</section><div id="update-live" class="sr-only" aria-live="polite"></div>';
}
function appCard(page,title,description){return '<button class="app-card" onclick="Velora.go(\''+page+'\')"><div class="app-icon">'+icons[page]+'</div><h3>'+escapeHtml(title)+'</h3><p>'+escapeHtml(description)+'</p></button>';}

function allModels(){
  var base=[
    {id:'smollm2-135m',name:'SmolLM2 135M',tag:'smollm2:135m',kind:'CPU tiny',category:'cpu',download:'270 MB'},
    {id:'smollm2-360m',name:'SmolLM2 360M',tag:'smollm2:360m',kind:'CPU tiny',category:'cpu',download:'730 MB'},
    {id:'qwen2.5-0.5b',name:'Qwen Micro 0.5B',tag:'qwen2.5:0.5b',kind:'CPU tiny',category:'cpu',download:'400 MB'},
    {id:'qwen2.5-coder-0.5b',name:'Qwen Coder Micro 0.5B',tag:'qwen2.5-coder:0.5b',kind:'CPU tiny',category:'cpu',download:'400 MB'},
    {id:'tinyllama-1.1b',name:'TinyLlama 1.1B',tag:'tinyllama:1.1b',kind:'CPU small',category:'cpu',download:'640 MB'},
    {id:'llama3.2-1b',name:'Llama 3.2 1B',tag:'llama3.2:1b',kind:'CPU small',category:'cpu',download:'1.3 GB'},
    {id:'moondream',name:'Moondream Vision',tag:'moondream',kind:'Vision',category:'vision',download:'1.7 GB'},
    {id:'llava-7b',name:'LLaVA 7B',tag:'llava:7b',kind:'Vision',category:'vision',download:'4.7 GB'}
  ];
  var byId={};base.forEach(function(model){byId[model.id]=model;});
  (S.models||[]).forEach(function(model){
    var id=model.id||model.tag;if(!id)return;
    var normal={id:id,name:model.name||id,tag:model.tag||model.ollama||id,kind:model.kind||model.category||'chat',category:model.category||'chat',download:model.download||model.size||'Unknown',availability:model.availability||{}};
    if(byId[id])Object.assign(byId[id],normal);else{base.push(normal);byId[id]=normal;}
  });
  return base;
}
function modelsPage(){
  var cpu=allModels().filter(function(model){return String(model.kind).indexOf('CPU')>=0;}).map(modelCard).join('');
  var all=allModels().map(modelCard).join('');
  return '<div class="section-head"><div><p class="eyebrow">Model library</p><h2>Models</h2><p class="lead">Curated choices, tiny CPU models and honest compatibility.</p></div><button class="back" onclick="Velora.go(\'home\')">Back</button></div><h3>Recommended models for your CPU</h3><div class="cards">'+cpu+'</div><h3 style="margin-top:28px">All models</h3><div class="cards">'+all+'</div>';
}
function modelCard(model){
  var installed=!!(model.availability&&model.availability.installed);
  var isAdmin=!!(S.user&&S.user.role==='admin');
  var primary=installed?'<button class="btn ghost" disabled>Installed</button>':'<button class="btn" onclick="Velora.installModel(\''+escapeHtml(model.id)+'\')">Install</button>';
  var remove=installed&&isAdmin?'<button class="danger-button" onclick="Velora.deleteModel(\''+escapeHtml(model.id)+'\',\''+escapeHtml(model.name)+'\')">Delete model</button>':'';
  var statusText=installed?'Installed and shared by every VeloraOS account.':'Storage after install shown during download.';
  return '<div class="model-card" id="model-'+escapeHtml(model.id)+'"><span class="tag '+(String(model.kind).indexOf('CPU')>=0?'':'warn')+'">'+escapeHtml(model.kind)+'</span><h3>'+escapeHtml(model.name)+'</h3><p class="muted">'+escapeHtml(model.tag)+'</p><div class="kv"><div><small>Download</small><b>'+escapeHtml(model.download)+'</b></div><div><small>Expected speed</small><b>'+(String(model.kind).indexOf('CPU')>=0?'Fast':'Depends')+'</b></div></div><div class="progress" hidden><span></span></div><p class="small muted status-line">'+statusText+'</p><div class="model-actions">'+primary+remove+'</div></div>';
}
async function installModel(id){
  var card=document.getElementById('model-'+CSS.escape(id));var bar=card&&card.querySelector('.progress');var fill=card&&card.querySelector('.progress span');var line=card&&card.querySelector('.status-line');var button=card&&card.querySelector('.btn');
  if(bar)bar.hidden=false;if(button)button.disabled=true;if(line)line.textContent='Starting download...';
  try{
    var start=await API.post('/api/models/'+encodeURIComponent(id)+'/install',{force:true,riskAccepted:true});
    for(var i=0;i<720;i++){
      await new Promise(function(resolve){setTimeout(resolve,1000);});
      var task=await API.get('/api/tasks/'+encodeURIComponent(start.task_id));
      if(fill)fill.style.width=Math.max(0,Math.min(100,Number(task.progress||0)))+'%';
      if(line)line.textContent=[task.downloaded&&task.total?(task.downloaded+' of '+task.total):'',task.speed,task.eta?('ETA '+task.eta):'',task.output||task.status].filter(Boolean).join(' · ');
      var state=String(task.status||'').toLowerCase();
      if(['complete','completed','done','success'].indexOf(state)>=0){if(fill)fill.style.width='100%';if(line)line.textContent='Installed and ready.';var refreshed=await API.get('/api/models');S.models=refreshed.models||refreshed||[];render();return;}
      if(['error','failed'].indexOf(state)>=0)throw new Error(task.error||'Install failed');
    }
  }catch(error){if(line)line.textContent=humanError(error);alert(humanError(error));if(button)button.disabled=false;}
}
async function deleteModel(id,name){
  if(!S.user||S.user.role!=='admin'){alert('Only an administrator can delete shared models.');return;}
  if(!window.confirm('Delete '+name+' from this VeloraOS server? This removes the model for every account.'))return;
  var card=document.getElementById('model-'+CSS.escape(id));
  var line=card&&card.querySelector('.status-line');
  var buttons=card?card.querySelectorAll('button'):[];
  Array.prototype.forEach.call(buttons,function(button){button.disabled=true;});
  if(line)line.textContent='Deleting model from Ollama...';
  try{
    await API.del('/api/models/'+encodeURIComponent(id));
    var payload=await API.get('/api/models');S.models=payload.models||payload||[];
    var selected=allModels().find(function(model){return model.id===S.selected;});
    if(selected&&!(selected.availability&&selected.availability.installed)){
      var next=allModels().find(function(model){return model.availability&&model.availability.installed;});
      if(next)S.selected=next.id;
    }
    render();
  }catch(error){
    if(line)line.textContent=humanError(error);
    Array.prototype.forEach.call(buttons,function(button){button.disabled=false;});
    alert(humanError(error));
  }
}

async function loadDiagnostics(){
  S.diagnosticsBusy=true;
  try{S.diagnostics=await API.get('/api/diagnostics');}
  catch(error){if(error.status===401){showLogin('Your session expired.');return;}S.diagnostics={error:humanError(error),warnings:[humanError(error)]};}
  finally{S.diagnosticsBusy=false;}
}
function diagnosticBadge(ready,yes,no){return '<span class="diagnostic-badge '+(ready?'ready':'not-ready')+'">'+escapeHtml(ready?(yes||'Ready'):(no||'Not ready'))+'</span>';}
function diagnosticFact(label,value,sub){return '<div class="diagnostic-fact"><small>'+escapeHtml(label)+'</small><strong>'+escapeHtml(value==null?'Unknown':value)+'</strong>'+(sub?'<span>'+escapeHtml(sub)+'</span>':'')+'</div>';}
function runtimeDiagnosticCard(name,data){
  data=data||{};
  var detail=data.runtimeVersion?('Runtime '+data.runtimeVersion):(data.version?('Version '+data.version):'');
  if(data.toolkitVersion)detail+=(detail?' · ':'')+'Toolkit '+data.toolkitVersion;
  if(data.devices&&data.devices.length)detail=(detail?detail+' · ':'')+data.devices.join(', ');
  return '<div class="diagnostic-runtime"><div><h4>'+escapeHtml(name)+'</h4><p>'+escapeHtml(data.message||'No status returned.')+'</p>'+(detail?'<small>'+escapeHtml(detail)+'</small>':'')+'</div>'+diagnosticBadge(!!data.ready)+'</div>';
}
function diagnosticGpuRows(){
  var d=S.diagnostics||{};var gpu=d.gpu||{};var devices=gpu.physicalDevices||[];
  if(!devices.length)return '<div class="diagnostic-empty">No physical GPU is visible to VeloraOS.</div>';
  return '<div class="diagnostic-table-wrap"><table class="diagnostic-table"><thead><tr><th>GPU</th><th>PCI address</th><th>PCI ID</th><th>Kernel driver</th></tr></thead><tbody>'+devices.map(function(item){return '<tr><td><b>'+escapeHtml(item.vendor||'GPU')+'</b><span>'+escapeHtml(item.name||'Unknown')+'</span></td><td>'+escapeHtml(item.address||'Unknown')+'</td><td><code>'+escapeHtml(item.pciId||'Unknown')+'</code></td><td>'+escapeHtml(item.driver||'Not bound')+'</td></tr>';}).join('')+'</tbody></table></div>';
}
function diagnosticVramRows(){
  var items=(((S.diagnostics||{}).gpu||{}).vram)||[];
  if(!items.length)return '<p class="muted small">Dedicated VRAM telemetry is unavailable for this device/runtime.</p>';
  return '<div class="diagnostic-vram-grid">'+items.map(function(item){return '<div class="diagnostic-vram"><div><b>'+escapeHtml(item.name||'GPU')+'</b><span>'+escapeHtml(item.address||'')+'</span></div><strong>'+escapeHtml(item.used||'Unknown')+' / '+escapeHtml(item.total||'Unknown')+'</strong><div class="diagnostic-meter"><span style="width:'+Math.max(0,Math.min(100,Number(item.usedPercent||0)))+'%"></span></div><small>'+escapeHtml(String(item.gpuUtilPercent||0))+'% GPU utilisation'+(item.temperatureC?' · '+escapeHtml(String(item.temperatureC))+'°C':'')+'</small></div>';}).join('')+'</div>';
}
function loadedModelRows(){
  var models=(S.diagnostics&&S.diagnostics.loadedModels)||[];
  if(!models.length)return '<div class="diagnostic-empty">No Ollama model is currently loaded. Run a chat or the acceleration test to load one.</div>';
  return '<div class="diagnostic-table-wrap"><table class="diagnostic-table"><thead><tr><th>Loaded model</th><th>Processor</th><th>CPU / GPU split</th><th>Memory</th><th>Context</th></tr></thead><tbody>'+models.map(function(model){return '<tr><td><b>'+escapeHtml(model.name||'Unknown')+'</b></td><td>'+diagnosticBadge(model.processor!=='CPU',model.processor||'Unknown',model.processor||'CPU')+'</td><td>'+escapeHtml(String(model.cpuPercent||0))+'% CPU · '+escapeHtml(String(model.gpuPercent||0))+'% GPU</td><td>'+escapeHtml(model.size||'Unknown')+' total · '+escapeHtml(model.vram||'0 B')+' VRAM</td><td>'+escapeHtml(model.contextLength?String(model.contextLength):'Unknown')+'</td></tr>';}).join('')+'</tbody></table></div>';
}
function accelerationTestHtml(){
  var installed=allModels().filter(function(model){return model.availability&&model.availability.installed;});
  var options=installed.map(function(model){return '<option value="'+escapeHtml(model.id)+'" '+(model.id===S.selected?'selected':'')+'>'+escapeHtml(model.name)+' · '+escapeHtml(model.tag)+'</option>';}).join('');
  var result=S.diagnosticsTest;
  var resultHtml='';
  if(result){var metrics=result.metrics||{};resultHtml='<div class="diagnostic-test-result"><div class="diagnostic-test-head"><div><small>Last test</small><h4>'+escapeHtml(result.model||'Ollama model')+'</h4></div>'+diagnosticBadge(!!result.accelerated,result.processor||'GPU accelerated',result.processor||'CPU')+'</div><div class="diagnostic-stats">'+diagnosticFact('Generation speed',(metrics.tokensPerSecond||0)+' tok/s')+diagnosticFact('Completion tokens',metrics.completionTokens||0)+diagnosticFact('Total duration',(metrics.totalDurationMs||result.wallDurationMs||0)+' ms')+diagnosticFact('Model placement',(result.gpuPercent||0)+'% GPU',result.message||'')+'</div></div>';}
  return '<section class="panel diagnostic-panel"><div class="diagnostic-panel-head"><div><p class="eyebrow">Acceleration test</p><h3>Verify real Ollama execution</h3><p class="muted">Runs an eight-token local generation and reads Ollama\'s live CPU/GPU placement.</p></div></div><div class="diagnostic-test-controls"><select id="diagnostic-model" '+(!installed.length||S.diagnosticsBusy?'disabled':'')+'>'+options+'</select><button class="btn" onclick="Velora.runAccelerationTest()" '+(!installed.length||S.diagnosticsBusy||!S.user||S.user.role!=='admin'?'disabled':'')+'>'+(S.diagnosticsBusy?'Testing…':'Run acceleration test')+'</button></div>'+(!installed.length?'<p class="small error-text">Install an Ollama model before running this test.</p>':'')+(S.user&&S.user.role!=='admin'?'<p class="small muted">Administrator access is required to run the load test.</p>':'')+resultHtml+'<p id="diagnostic-test-status" class="small" role="status" aria-live="polite"></p></section>';
}
function diagnosticsPage(){
  var d=S.diagnostics||{};if(!S.diagnostics)return '<div class="section-head"><div><p class="eyebrow">Hardware intelligence</p><h2>GPU & Ollama Diagnostics</h2></div></div><div class="panel"><p>Loading diagnostics…</p></div>';
  if(d.error)return '<div class="section-head"><div><p class="eyebrow">Hardware intelligence</p><h2>GPU & Ollama Diagnostics</h2></div><button class="back" onclick="Velora.refreshDiagnostics()">Retry</button></div><div class="panel"><p class="error-text">'+escapeHtml(d.error)+'</p></div>';
  var virtual=d.virtualization||{};var gpu=d.gpu||{};var memory=d.memory||{};var ollama=d.ollama||{};var runtimes=d.runtimes||{};
  var warnings=(d.warnings||[]).map(function(item){return '<li>'+escapeHtml(item)+'</li>';}).join('');
  return '<div class="section-head"><div><p class="eyebrow">Hardware intelligence</p><h2>GPU & Ollama Diagnostics</h2><p class="lead">See exactly what Linux, the VM, the GPU runtimes and Ollama can use.</p></div><div class="section-actions"><button class="btn ghost" onclick="Velora.refreshDiagnostics()" '+(S.diagnosticsBusy?'disabled':'')+'>'+(S.diagnosticsBusy?'Refreshing…':'Refresh diagnostics')+'</button><button class="back" onclick="Velora.go(\'home\')">Back</button></div></div>'+(warnings?'<div class="diagnostic-warning"><b>Needs attention</b><ul>'+warnings+'</ul></div>':'')+'<div class="diagnostic-summary">'+diagnosticFact('Environment',virtual.isVirtual?('Virtual · '+virtual.type):'Physical',virtual.product)+diagnosticFact('GPU passthrough',gpu.passthroughDetected?'Detected':(virtual.isVirtual?'Not detected':'Not required'))+diagnosticFact('System memory',memory.used+' / '+memory.total,(memory.usedPercent||0)+'% used')+diagnosticFact('Ollama',ollama.ready?'Ready':'Not ready',ollama.version?('Version '+ollama.version):ollama.message)+'</div><section class="panel diagnostic-panel"><div class="diagnostic-panel-head"><div><p class="eyebrow">PCI hardware</p><h3>Physical GPU and passthrough</h3></div>'+diagnosticBadge((gpu.physicalDevices||[]).length>0,(gpu.physicalDevices||[]).length+' GPU detected','CPU only')+'</div>'+diagnosticGpuRows()+diagnosticVramRows()+'</section><section class="panel diagnostic-panel"><div class="diagnostic-panel-head"><div><p class="eyebrow">Runtime health</p><h3>CUDA, ROCm and Vulkan</h3></div></div><div class="diagnostic-runtime-grid">'+runtimeDiagnosticCard('CUDA',runtimes.cuda)+runtimeDiagnosticCard('ROCm',runtimes.rocm)+runtimeDiagnosticCard('Vulkan',runtimes.vulkan)+'</div></section><section class="panel diagnostic-panel"><div class="diagnostic-panel-head"><div><p class="eyebrow">Ollama process state</p><h3>CPU/GPU model usage</h3><p class="muted">Ollama reports model placement only while a model is loaded.</p></div>'+diagnosticBadge(!!ollama.ready,ollama.installedModelCount+' installed','Offline')+'</div>'+loadedModelRows()+'</section>'+accelerationTestHtml();
}
async function refreshDiagnostics(){await loadDiagnostics();render();}
async function runAccelerationTest(){
  var select=$('#diagnostic-model');var modelId=select&&select.value?select.value:S.selected;S.diagnosticsBusy=true;render();setStatus('diagnostic-test-status','Running a short local generation…',false);
  try{S.diagnosticsTest=await API.post('/api/diagnostics/acceleration-test',{modelId:modelId});S.diagnostics=await API.get('/api/diagnostics');}
  catch(error){S.diagnosticsTest=null;S.diagnostics=Object.assign({},S.diagnostics||{},{testError:humanError(error)});}
  finally{S.diagnosticsBusy=false;render();if(S.diagnostics&&S.diagnostics.testError)setStatus('diagnostic-test-status',S.diagnostics.testError,true);}
}

function pendingImagesHtml(){
  if(!S.pendingImages.length)return '';
  return '<div class="pending-images">'+S.pendingImages.map(function(image,index){return '<div class="pending-image"><img src="'+escapeHtml(image.dataUrl)+'" alt="'+escapeHtml(image.name||('image '+(index+1)))+'"><button type="button" class="pending-remove" onclick="Velora.removePendingImage('+index+')">×</button><div class="pending-label">'+escapeHtml(image.name||('image '+(index+1)))+'</div></div>';}).join('')+'</div>';
}
function imageStrip(images){
  if(!images||!images.length)return '';
  return '<div class="msg-images">'+images.map(function(image,index){var src=typeof image==='string'?image:(image.dataUrl||image.url||image.data||'');var name=typeof image==='string'?('image '+(index+1)):(image.name||('image '+(index+1)));return '<div class="msg-image"><img src="'+escapeHtml(src)+'" alt="'+escapeHtml(name)+'"><div class="msg-label">'+escapeHtml(name)+'</div></div>';}).join('')+'</div>';
}
function serializableMessages(){return S.msgs.map(function(message){return {role:message.role,content:message.content||'',images:(message.images||[]).map(function(image){if(typeof image==='string')return {dataUrl:image,name:'image'};return {dataUrl:image.dataUrl||image.url||image.data||'',name:image.name||'image'};})};});}
function handleImageFiles(fileList){
  var files=Array.from(fileList||[]);if(!files.length)return;
  if(S.pendingImages.length>=4){alert('You can queue up to 4 images at once.');return;}
  files.slice(0,4-S.pendingImages.length).forEach(function(file){
    if(!file.type||file.type.indexOf('image/')!==0)return;
    if(file.size>5*1024*1024){alert(file.name+' is over 5 MB and was skipped.');return;}
    var reader=new FileReader();
    reader.onload=function(){S.pendingImages.push({name:file.name,type:file.type,size:file.size,dataUrl:String(reader.result)});render();var prompt=$('#prompt');if(prompt)prompt.focus();};
    reader.readAsDataURL(file);
  });
}
function handlePaste(event){
  var items=(event.clipboardData&&event.clipboardData.items)?Array.from(event.clipboardData.items):[];var files=[];
  items.forEach(function(item){if(item.type&&item.type.indexOf('image/')===0){var file=item.getAsFile();if(file)files.push(file);}});
  if(files.length){event.preventDefault();handleImageFiles(files);}
}
function removePendingImage(index){S.pendingImages.splice(index,1);render();}
function openImagePicker(){var input=$('#image-input');if(input)input.click();}

var COSMIC_REASONING_LEVELS={
  1:{label:'Fast',description:'Quick, direct answers with the smallest generation budget.'},
  2:{label:'Balanced',description:'A useful balance of speed, detail and reasoning.'},
  3:{label:'Deep',description:'More analysis, structure and assumption checking.'},
  4:{label:'Extra High',description:'Deep analysis with alternatives and edge cases.'},
  5:{label:'Maximum Power',description:'Maximum reasoning effort with the largest response budget.'}
};
function clampReasoning(value){var number=parseInt(value,10);return Math.max(1,Math.min(5,isFinite(number)?number:2));}
function reasoningMeta(value){return COSMIC_REASONING_LEVELS[clampReasoning(value)]||COSMIC_REASONING_LEVELS[2];}
function reasoningDotsHtml(){return [1,2,3,4,5].map(function(level){return '<span class="cosmic-dot '+(level<=S.reasoning?'active ':'')+(level===5?'final':'')+'"></span>';}).join('');}
function cosmicReasoningHtml(){
  var level=clampReasoning(S.reasoning);var meta=reasoningMeta(level);var maximum=level===5;var cls=maximum?' maximum':'';
  return '<div class="cosmic-reasoning'+cls+'"><button type="button" id="cosmic-button" class="cosmic-button'+cls+'" onclick="Velora.toggleCosmicReasoning()" title="Adjust thinking power"><span class="cosmic-spark">✦</span><span class="cosmic-copy"><b>Cosmic Reasoning</b><small id="cosmic-level-label">'+escapeHtml(meta.label)+'</small></span><span class="cosmic-chevron">⌃</span></button><div id="cosmic-popover" class="cosmic-popover '+(S.reasoningOpen?'open ':'')+(maximum?'maximum':'')+'"><div class="cosmic-popover-head"><div><span class="cosmic-eyebrow">Thinking power</span><h4>Cosmic Reasoning</h4></div><span class="cosmic-level-number" id="cosmic-level-number">'+level+'/5</span></div><input id="cosmic-range" class="cosmic-range" type="range" min="1" max="5" step="1" value="'+level+'" oninput="Velora.previewCosmicReasoning(this.value)" onchange="Velora.commitCosmicReasoning(this.value)"><div class="cosmic-dots" id="cosmic-dots">'+reasoningDotsHtml()+'</div><div class="cosmic-status"><b id="cosmic-status-title">'+escapeHtml(meta.label)+'</b><p id="cosmic-status-description">'+escapeHtml(meta.description)+'</p></div><div class="cosmic-warning">Higher power can take longer and use more CPU/GPU time.</div></div></div>';
}
function toggleCosmicReasoning(){S.reasoningOpen=!S.reasoningOpen;render();}
function refreshCosmicReasoningUi(){
  var level=clampReasoning(S.reasoning);var meta=reasoningMeta(level);var maximum=level===5;
  var root=document.querySelector('.cosmic-reasoning');var button=$('#cosmic-button');var popover=$('#cosmic-popover');
  [root,button,popover].forEach(function(node){if(node)node.classList.toggle('maximum',maximum);});
  var topBar=document.querySelector('.top');if(topBar)topBar.classList.toggle('cosmic-maximum',maximum&&S.page==='chat');
  var headerBadge=$('#cosmic-header-badge');if(headerBadge)headerBadge.hidden=!(maximum&&S.page==='chat');
  var label=$('#cosmic-level-label');if(label)label.textContent=meta.label;
  var number=$('#cosmic-level-number');if(number)number.textContent=level+'/5';
  var title=$('#cosmic-status-title');if(title)title.textContent=meta.label;
  var description=$('#cosmic-status-description');if(description)description.textContent=meta.description;
  var dots=$('#cosmic-dots');if(dots)dots.innerHTML=reasoningDotsHtml();
}
function previewCosmicReasoning(value){S.reasoning=clampReasoning(value);refreshCosmicReasoningUi();}
async function commitCosmicReasoning(value){
  S.reasoning=clampReasoning(value);refreshCosmicReasoningUi();
  S.settings=Object.assign({},S.settings,{cosmic_reasoning:S.reasoning});
  try{await API.post('/api/settings',{settings:S.settings});}catch(error){if(error.status===401)showLogin('Your session expired.');else alert(humanError(error));}
}

function escapeAttribute(value){return escapeHtml(value).replace(/`/g,'&#96;');}
function inlineMarkdown(value){
  var source=String(value==null?'':value);var tokens=[];
  source=source.replace(/`([^`\n]+)`/g,function(_,code){var id=tokens.length;tokens.push('<code class="inline-code">'+escapeHtml(code)+'</code>');return '\u0000'+id+'\u0000';});
  var html=escapeHtml(source);
  html=html.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/__([^_]+)__/g,'<strong>$1</strong>');
  html=html.replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/g,'$1<em>$2</em>');
  html=html.replace(/\u0000(\d+)\u0000/g,function(_,index){return tokens[Number(index)]||'';});
  return html;
}
function codeKeywords(language){
  var common='break case catch class const continue def delete do else enum export extends false finally for from function if import in instanceof interface let new null package private protected public raise return static super switch this throw true try typeof undefined var void while with yield async await'.split(' ');
  var extra={python:'and as assert elif except global is lambda None nonlocal not or pass True False',py:'and as assert elif except global is lambda None nonlocal not or pass True False',bash:'then fi done esac function local export readonly',sh:'then fi done esac function local export readonly',javascript:'of get set constructor',js:'of get set constructor',typescript:'type keyof namespace declare implements abstract readonly',ts:'type keyof namespace declare implements abstract readonly',json:''};
  return common.concat(String(extra[String(language||'').toLowerCase()]||'').split(' ').filter(Boolean));
}
function highlightCode(code,language){
  var keywords=codeKeywords(language);var keywordSet={};keywords.forEach(function(word){keywordSet[word]=true;});
  var pattern=/(\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b)/g;
  var result='';var last=0;String(code||'').replace(pattern,function(token,_,offset){
    result+=escapeHtml(String(code).slice(last,offset));var cls='';
    if(/^\/\*|^\/\/|^#/.test(token))cls='syntax-comment';
    else if(/^["'`]/.test(token))cls='syntax-string';
    else if(/^\d/.test(token))cls='syntax-number';
    else if(keywordSet[token])cls='syntax-keyword';
    result+=cls?'<span class="'+cls+'">'+escapeHtml(token)+'</span>':escapeHtml(token);last=offset+token.length;return token;
  });
  result+=escapeHtml(String(code).slice(last));return result;
}
function isTableDivider(line){return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line||'');}
function tableCells(line){var value=String(line||'').trim();if(value.charAt(0)==='|')value=value.slice(1);if(value.charAt(value.length-1)==='|')value=value.slice(0,-1);return value.split('|').map(function(cell){return cell.trim();});}
function renderMarkdown(value){
  var lines=String(value==null?'':value).replace(/\r\n?/g,'\n').split('\n');var html=[];var i=0;
  while(i<lines.length){var line=lines[i];
    var fence=line.match(/^\s*```([A-Za-z0-9_+.-]*)\s*$/);if(fence){var language=fence[1]||'text';var code=[];i++;while(i<lines.length&&!/^\s*```\s*$/.test(lines[i])){code.push(lines[i]);i++;}if(i<lines.length)i++;var raw=code.join('\n');html.push('<div class="code-block"><div class="code-head"><span>'+escapeHtml(language)+'</span><button type="button" onclick="Velora.copyCode(this)" data-code="'+escapeAttribute(encodeURIComponent(raw))+'">Copy code</button></div><pre><code class="language-'+escapeAttribute(language)+'">'+highlightCode(raw,language)+'</code></pre></div>');continue;}
    if(i+1<lines.length&&line.indexOf('|')>=0&&isTableDivider(lines[i+1])){var headers=tableCells(line);var rows=[];i+=2;while(i<lines.length&&lines[i].indexOf('|')>=0&&lines[i].trim()){rows.push(tableCells(lines[i]));i++;}html.push('<div class="markdown-table-wrap"><table class="markdown-table"><thead><tr>'+headers.map(function(cell){return '<th>'+inlineMarkdown(cell)+'</th>';}).join('')+'</tr></thead><tbody>'+rows.map(function(row){return '<tr>'+headers.map(function(_,index){return '<td>'+inlineMarkdown(row[index]||'')+'</td>';}).join('')+'</tr>';}).join('')+'</tbody></table></div>');continue;}
    var heading=line.match(/^\s*(#{1,4})\s+(.+)$/);if(heading){var level=Math.min(4,heading[1].length+1);html.push('<h'+level+'>'+inlineMarkdown(heading[2])+'</h'+level+'>');i++;continue;}
    if(/^\s*>\s?/.test(line)){var quote=[];while(i<lines.length&&/^\s*>\s?/.test(lines[i])){quote.push(lines[i].replace(/^\s*>\s?/,''));i++;}html.push('<blockquote>'+quote.map(inlineMarkdown).join('<br>')+'</blockquote>');continue;}
    if(/^\s*[-*+]\s+/.test(line)){var list=[];while(i<lines.length&&/^\s*[-*+]\s+/.test(lines[i])){list.push(lines[i].replace(/^\s*[-*+]\s+/,''));i++;}html.push('<ul>'+list.map(function(item){return '<li>'+inlineMarkdown(item)+'</li>';}).join('')+'</ul>');continue;}
    if(/^\s*\d+[.)]\s+/.test(line)){var ordered=[];while(i<lines.length&&/^\s*\d+[.)]\s+/.test(lines[i])){ordered.push(lines[i].replace(/^\s*\d+[.)]\s+/,''));i++;}html.push('<ol>'+ordered.map(function(item){return '<li>'+inlineMarkdown(item)+'</li>';}).join('')+'</ol>');continue;}
    if(!line.trim()){html.push('');i++;continue;}
    var paragraph=[line];i++;while(i<lines.length&&lines[i].trim()&&!/^\s*```/.test(lines[i])&&!/^\s*(#{1,4})\s+/.test(lines[i])&&!/^\s*>\s?/.test(lines[i])&&!/^\s*[-*+]\s+/.test(lines[i])&&!/^\s*\d+[.)]\s+/.test(lines[i])&&!(i+1<lines.length&&lines[i].indexOf('|')>=0&&isTableDivider(lines[i+1]))){paragraph.push(lines[i]);i++;}html.push('<p>'+paragraph.map(inlineMarkdown).join('<br>')+'</p>');
  }
  return html.join('');
}
function messageStatsHtml(message){var stats=message&&message.stats;if(!stats)return '';var parts=[];if(stats.totalTokens)parts.push(stats.totalTokens+' tokens');if(stats.tokensPerSecond)parts.push(stats.tokensPerSecond+' tok/s');if(stats.totalDurationMs)parts.push((stats.totalDurationMs/1000).toFixed(2)+'s');return parts.length?'<div class="message-stats">'+parts.map(function(part){return '<span>'+escapeHtml(part)+'</span>';}).join('')+'</div>':'';}
function messageActionsHtml(message,index){
  var actions='<button type="button" onclick="Velora.copyMessage('+index+',this)">Copy</button>';
  if(message.role==='user')actions+='<button type="button" onclick="Velora.beginEditMessage('+index+')">Edit & resend</button>';
  else actions+='<button type="button" onclick="Velora.regenerateMessage('+index+')">Regenerate</button>';
  return '<div class="message-actions">'+actions+'</div>';
}
function chatPage(){
  var editing=S.editingIndex!==null;var promptValue=editing?S.editingDraft:'';
  return '<div class="shell">'+top()+'<div class="chat-wrap"><aside class="chat-sidebar"><button class="new-chat" onclick="Velora.newChat()">+ New chat</button><input class="search" placeholder="Search titles and messages" value="'+escapeHtml(S.search)+'" oninput="Velora.setSearch(this.value)"><div class="chat-list">'+filteredChats().map(function(chat){return '<div class="chat-row '+(S.active===chat.id?'active':'')+'"><button class="chat-item" onclick="Velora.openChat(\''+chat.id+'\')">'+escapeHtml(chat.title||'New chat')+'</button><button class="chat-delete" onclick="Velora.deleteChat(\''+chat.id+'\')" aria-label="Delete '+escapeHtml(chat.title||'chat')+'" title="Delete chat">×</button></div>';}).join('')+'</div></aside><section class="chat-main"><div class="chat-top"><div class="chat-title-group"><div class="chat-top-title">'+escapeHtml(currentTitle())+'</div><button class="chat-title-action" onclick="Velora.renameChat()">Rename</button></div><div class="chat-top-actions"><button onclick="Velora.exportChat(\'markdown\')">Export Markdown</button><button onclick="Velora.exportChat(\'json\')">Export JSON</button><div class="model-picker"><button class="model-button" onclick="Velora.toggleModelMenu()">'+escapeHtml(modelName(S.selected))+' ▾</button><div class="model-menu '+(S.menu?'open':'')+'">'+allModels().map(function(model){return '<button class="model-option" onclick="Velora.selectModel(\''+escapeHtml(model.id)+'\')"><b>'+escapeHtml(model.name)+'</b><small>'+escapeHtml(model.kind)+'</small></button>';}).join('')+'</div></div></div></div><div class="messages" id="messages"><div class="messages-inner" id="messages-inner">'+(S.error?'<div class="chat-error">'+escapeHtml(S.error)+'</div>':'')+(S.chatNotice?'<div class="chat-notice">'+escapeHtml(S.chatNotice)+'</div>':'')+(S.msgs.length?S.msgs.map(messageHtml).join(''):emptyChat())+'</div></div><div class="composer-wrap"><div class="composer-stack">'+(editing?'<div class="edit-banner"><div><b>Editing an earlier message</b><span>Sending will replace every response after it.</span></div><button type="button" onclick="Velora.cancelEditMessage()">Cancel</button></div>':'')+'<div class="composer-toolbar"><div class="composer-toolbar-left"><button class="upload-btn" type="button" onclick="Velora.openImagePicker()">Upload image</button><input id="image-input" type="file" accept="image/*" multiple hidden><span class="vision-chip">Paste images straight into chat · use Moondream/LLaVA for vision</span></div><div class="composer-toolbar-right">'+cosmicReasoningHtml()+'</div></div>'+pendingImagesHtml()+'<div class="composer"><textarea id="prompt" placeholder="'+(editing?'Edit this message and resend…':'Message VeloraOS or paste an image…')+'" rows="1">'+escapeHtml(promptValue)+'</textarea><button class="send" id="send-btn" onclick="Velora.send()">➜</button></div><div class="hint">Enter to send · Shift+Enter for a new line · copy, edit, regenerate, rename and export are available above</div></div></div></section></div></div>';
}
function afterChat(){
  var input=$('#prompt');
  if(input){input.addEventListener('input',function(){this.style.height='auto';this.style.height=Math.min(this.scrollHeight,180)+'px';if(S.editingIndex!==null)S.editingDraft=this.value;});input.addEventListener('keydown',function(event){if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();send();}});input.addEventListener('paste',handlePaste);input.style.height='auto';input.style.height=Math.min(input.scrollHeight,180)+'px';if(S.editingIndex!==null){input.focus();input.setSelectionRange(input.value.length,input.value.length);}}
  var picker=$('#image-input');if(picker){picker.addEventListener('change',function(event){Velora.handleImageFiles(event.target.files);this.value='';});}
  scrollChat();
}
function scrollChat(){var box=$('#messages');if(box)box.scrollTop=box.scrollHeight;}
function filteredChats(){var query=S.search.toLowerCase().trim();return S.chats.filter(function(chat){if(!query)return true;var haystack=[chat.title||''].concat((chat.messages||[]).map(function(message){return message.content||'';})).join('\n').toLowerCase();return haystack.indexOf(query)>=0;});}
function currentTitle(){var chat=S.chats.find(function(item){return item.id===S.active;});return chat&&chat.title?chat.title:'New chat';}
function modelName(id){var model=allModels().find(function(item){return item.id===id;});return model?model.name:id;}
function emptyChat(){return '<div class="empty-chat"><div class="empty-orb">'+icons.chat+'</div><h2>How can I help?</h2><p>Choose any installed model and ask anything. This private chat workspace is custom-built for VeloraOS.</p></div>';}
function messageHtml(message,index){var body=message.role==='assistant'?renderMarkdown(message.content||''):('<p>'+inlineMarkdown(message.content||'').replace(/\n/g,'<br>')+'</p>');return '<div class="msg" data-message-index="'+index+'">'+chatAvatar(message.role)+'<div class="msg-content"><div class="msg-role">'+(message.role==='user'?escapeHtml((S.user&&S.user.display_name)||'You'):'VeloraOS')+'</div><div class="msg-body">'+imageStrip(message.images)+body+'</div>'+messageStatsHtml(message)+messageActionsHtml(message,index)+'</div></div>';}
function setSearch(value){S.search=value;render();}
function toggleModelMenu(){S.menu=!S.menu;render();}
function selectModel(id){S.selected=id;S.menu=false;saveActive();render();}
function newChat(){var id=(window.crypto&&crypto.randomUUID)?crypto.randomUUID():String(Date.now());S.active=id;S.msgs=[];S.pendingImages=[];S.error='';S.chatNotice='';S.editingIndex=null;S.editingDraft='';S.chats=[{id:id,title:'New chat',model:S.selected,messages:[],createdAt:new Date().toISOString()}].concat(S.chats);saveChats();render();}
function openChat(id){var chat=S.chats.find(function(item){return item.id===id;});if(!chat)return;S.active=id;S.msgs=chat.messages||[];S.selected=chat.model||S.selected;S.pendingImages=[];S.error='';S.chatNotice='';S.editingIndex=null;S.editingDraft='';render();}
async function deleteChat(id){
  var chat=S.chats.find(function(item){return item.id===id;});if(!chat)return;
  if(!window.confirm('Delete “'+(chat.title||'New chat')+'”? This cannot be undone.'))return;
  S.chats=S.chats.filter(function(item){return item.id!==id;});
  if(S.active===id){var next=S.chats[0]||null;if(next){S.active=next.id;S.msgs=next.messages||[];S.selected=next.model||S.selected;}else{S.active=null;S.msgs=[];}S.pendingImages=[];S.error='';S.editingIndex=null;S.editingDraft='';}
  await saveChats();render();
}
async function saveChats(){localStorage.setItem(localChatKey(),JSON.stringify(S.chats));try{await API.post('/api/chats',{chats:S.chats});}catch(error){if(error.status===401)showLogin('Your session expired.');}}
function saveActive(){var chat=S.chats.find(function(item){return item.id===S.active;});if(!chat)return saveChats();chat.messages=S.msgs;chat.model=S.selected;chat.updatedAt=new Date().toISOString();if(!chat.createdAt)chat.createdAt=chat.updatedAt;if(!chat.title||chat.title==='New chat'){chat.title=(S.msgs.find(function(message){return message.role==='user';})||{}).content||chat.title||'New chat';if(chat.title.length>42)chat.title=chat.title.slice(0,42);}saveChats();}
function renameChat(){var chat=S.chats.find(function(item){return item.id===S.active;});if(!chat)return;var name=window.prompt('Rename this chat',chat.title||'New chat');if(name===null)return;name=String(name).trim();if(!name)return;chat.title=name.slice(0,80);saveChats();render();}
function safeFilename(value){return String(value||'veloraos-chat').trim().toLowerCase().replace(/[^a-z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80)||'veloraos-chat';}
function downloadText(filename,content,type){var blob=new Blob([content],{type:type||'text/plain;charset=utf-8'});var url=URL.createObjectURL(blob);var anchor=document.createElement('a');anchor.href=url;anchor.download=filename;document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(function(){URL.revokeObjectURL(url);},1000);}
function exportChat(format){var chat=S.chats.find(function(item){return item.id===S.active;});if(!chat)return;var base=safeFilename(chat.title);if(format==='json'){downloadText(base+'.json',JSON.stringify(chat,null,2),'application/json;charset=utf-8');return;}var lines=['# '+(chat.title||'VeloraOS chat'),'','Model: '+(chat.model||S.selected),''];(chat.messages||[]).forEach(function(message){lines.push('## '+(message.role==='user'?((S.user&&S.user.display_name)||'User'):'VeloraOS'),'',message.content||'');(message.images||[]).forEach(function(image){lines.push('','Attachment: '+((image&&image.name)||'image'));});if(message.stats){lines.push('','_Stats: '+(message.stats.totalTokens||0)+' tokens · '+(message.stats.tokensPerSecond||0)+' tok/s_');}lines.push('');});downloadText(base+'.md',lines.join('\n'),'text/markdown;charset=utf-8');}
async function copyPlainText(text,button){try{if(navigator.clipboard&&window.isSecureContext)await navigator.clipboard.writeText(text);else{var area=document.createElement('textarea');area.value=text;area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();document.execCommand('copy');area.remove();}if(button){var old=button.textContent;button.textContent='Copied';setTimeout(function(){button.textContent=old;},1200);}}catch(error){alert('Copy failed: '+humanError(error));}}
function copyMessage(index,button){var message=S.msgs[index];if(message)copyPlainText(message.content||'',button);}
function copyCode(button){var encoded=button&&button.getAttribute('data-code')||'';var text='';try{text=decodeURIComponent(encoded);}catch(_){text=encoded;}copyPlainText(text,button);}
function beginEditMessage(index){var message=S.msgs[index];if(!message||message.role!=='user'||S.busy)return;S.editingIndex=index;S.editingDraft=message.content||'';S.pendingImages=(message.images||[]).map(function(image){return typeof image==='string'?{dataUrl:image,name:'image'}:{dataUrl:image.dataUrl||image.url||image.data||'',name:image.name||'image'};});S.chatNotice='';render();}
function cancelEditMessage(){S.editingIndex=null;S.editingDraft='';S.pendingImages=[];render();}
function createMessageElement(message){
  var div=document.createElement('div');div.className='msg';div.innerHTML=chatAvatar(message.role)+'<div class="msg-content"><div class="msg-role">'+(message.role==='user'?escapeHtml((S.user&&S.user.display_name)||'You'):'VeloraOS')+'</div><div class="msg-body"></div></div>';
  var body=div.querySelector('.msg-body');if(message.images&&message.images.length)body.insertAdjacentHTML('beforeend',imageStrip(message.images));if(message.content)body.appendChild(document.createTextNode(message.content));return {root:div,body:body};
}
async function stopGeneration(){
  if(!S.busy)return;S.stopRequested=true;if(S.controller)S.controller.abort();var model=allModels().find(function(item){return item.id===S.selected;});try{await API.post('/api/chat/stop',{model:model&&model.tag?model.tag:S.selected,model_id:S.selected});}catch(_){ }
}
async function performGeneration(){
  if(S.busy||!S.msgs.length)return;S.busy=true;S.stopRequested=false;S.controller=new AbortController();S.error='';S.chatNotice='';render();
  var wrap=$('#messages-inner');if(!wrap){S.busy=false;S.controller=null;return;}var assistantNode=createMessageElement({role:'assistant',content:'',images:[]});assistantNode.body.innerHTML='<span class="typing"><span></span><span></span><span></span></span>';wrap.appendChild(assistantNode.root);scrollChat();var button=$('#send-btn');if(button){button.textContent='■';button.classList.add('stop');button.onclick=stopGeneration;button.title='Stop generation';}
  var saved=false;
  try{var model=allModels().find(function(item){return item.id===S.selected;});var response=await API.post('/api/chat',{model:model&&model.tag?model.tag:S.selected,model_id:S.selected,messages:serializableMessages(),reasoning_power:S.reasoning},S.controller.signal);var text=response.response||response.message||response.content||'No response returned.';assistantNode.body.textContent='';var shown='';for(var i=0;i<text.length;i++){if(S.stopRequested)break;shown+=text[i];assistantNode.body.textContent=shown;if(i%4===0){scrollChat();await new Promise(function(resolve){setTimeout(resolve,6);});}}if(S.stopRequested){var partial=shown.trim();var stopped=partial?partial+'\n\n[Generation stopped]':'Generation stopped.';S.msgs.push({role:'assistant',content:stopped,stats:response.stats||null,createdAt:new Date().toISOString()});}else S.msgs.push({role:'assistant',content:text,stats:response.stats||null,createdAt:new Date().toISOString()});saved=true;}
  catch(error){if((error&&error.name==='AbortError')||S.stopRequested){S.msgs.push({role:'assistant',content:'Generation stopped.',createdAt:new Date().toISOString()});saved=true;}else{S.error=humanError(error);if(error.status===401){showLogin('Your session expired.');return;}}}
  finally{S.busy=false;S.controller=null;S.stopRequested=false;if(saved||S.error)saveActive();render();}
}
async function send(){
  var input=$('#prompt');var prompt=input&&input.value.trim();var queued=S.pendingImages.slice();if((!prompt&&!queued.length)||S.busy)return;if(!S.active)newChat();var effectivePrompt=prompt||('Please describe the uploaded image'+(queued.length>1?'s.':'.'));var message={role:'user',content:effectivePrompt,images:queued,createdAt:new Date().toISOString()};if(S.editingIndex!==null){var index=S.editingIndex;S.msgs=S.msgs.slice(0,index);S.msgs.push(message);S.editingIndex=null;S.editingDraft='';S.chatNotice='Conversation updated from the edited message.';}else S.msgs.push(message);S.pendingImages=[];saveActive();await performGeneration();
}
async function regenerateMessage(index){
  if(S.busy)return;var message=S.msgs[index];if(!message||message.role!=='assistant')return;var previous=-1;for(var i=index-1;i>=0;i--){if(S.msgs[i].role==='user'){previous=i;break;}}if(previous<0)return;S.msgs=S.msgs.slice(0,index);S.chatNotice='Regenerating the response…';saveActive();await performGeneration();
}

function setupDone(step){
  var x=S.setup||{};
  return {1:!!x.passwordChanged,2:!!x.deviceNamed,3:!!x.licenseReady,4:!!x.hardwareChecked,5:!!x.ollamaChecked,6:!!(x.modelInstalled||x.anyModelInstalled||x.modelSkipped),7:!!x.ready}[step];
}
function setupStepsHtml(){
  var labels=['Password','Device','Licence','Hardware','Ollama','Model','Ready'];
  return '<div class="setup-steps" aria-label="Setup progress">'+labels.map(function(label,index){var n=index+1;return '<button class="setup-step '+(S.setupStep===n?'active ':'')+(setupDone(n)?'done':'')+'" onclick="Velora.setSetupStep('+n+')"><span>'+(setupDone(n)?'✓':n)+'</span><b>'+label+'</b></button>';}).join('')+'</div>';
}
function setupFact(label,value){return '<div class="setup-fact"><small>'+escapeHtml(label)+'</small><strong>'+escapeHtml(value||'Unknown')+'</strong></div>';}
function setupPasswordStep(){
  if(S.setup&&S.setup.passwordChanged)return '<div class="setup-step-card success-card"><span class="setup-big-icon">✓</span><h2>Administrator password secured</h2><p>The default password is no longer active.</p></div>';
  return '<div class="setup-step-card"><p class="eyebrow">Required security step</p><h2>Change the default password</h2><p class="lead">Fresh VeloraOS installs use the default administrator password <b>veloraos</b>. Enter that as the current password, then choose your own password before the dashboard unlocks.</p><div class="setup-form-grid"><div class="field"><label>Current password <span class="muted">(default: veloraos)</span></label><input id="setup-current-password" type="password" autocomplete="current-password" placeholder="Default password: veloraos"></div><div class="field"><label>New password</label><input id="setup-new-password" type="password" autocomplete="new-password" placeholder="At least 8 characters"></div><div class="field"><label>Confirm new password</label><input id="setup-confirm-password" type="password" autocomplete="new-password" placeholder="Repeat new password"></div></div><button class="btn" '+(S.setupBusy?'disabled':'')+' onclick="Velora.changeSetupPassword()">Secure administrator account</button><p id="setup-action-status" class="small" role="status" aria-live="polite"></p></div>';
}
function setupDeviceStep(){
  var value=S.setupDeviceDraft!==null?S.setupDeviceDraft:((S.setup&&S.setup.deviceName)||'');
  return '<div class="setup-step-card"><p class="eyebrow">Device identity</p><h2>Name this VeloraOS system</h2><p class="lead">This friendly name appears in licensing and helps you identify the machine later.</p><div class="field setup-wide-field"><label>Device name</label><input id="setup-device-name" maxlength="120" value="'+escapeHtml(value)+'" placeholder="Studio Server VeloraOS" oninput="Velora.updateSetupDeviceDraft(this.value)" onkeydown="if(event.key===&quot;Enter&quot;){event.preventDefault();Velora.saveSetupDeviceName(true)}"></div><button class="btn" '+(S.setupBusy?'disabled':'')+' onclick="Velora.saveSetupDeviceName(false)">Save device name</button><p class="small muted">You can also enter a name and press Continue; VeloraOS will save it automatically.</p><p id="setup-action-status" class="small" role="status" aria-live="polite"></p></div>';
}
function setupLicenceStep(){
  var l=(S.setup&&S.setup.license)||S.license||{};var active=!!(S.setup&&S.setup.licenseReady);
  var details=setupFact('Status',licenseStateLabel(l.status))+setupFact('Plan',l.planName||'Not active')+setupFact('Licence',l.maskedKey||'Not configured')+setupFact('Connection',l.connectionState||'Unknown');
  var entry=active?'':'<div class="field setup-wide-field"><label>Licence key</label><input id="setup-license-key" type="password" autocomplete="off" spellcheck="false" placeholder="VLOS-XXXX-XXXX-XXXX-XXXX-XXXX"></div>';
  return '<div class="setup-step-card '+(active?'success-card':'')+'"><p class="eyebrow">Production entitlement</p><h2>'+(active?'Licence verified':'Verify your VeloraOS licence')+'</h2><p class="lead">The full key is handled only by the local backend and is never returned to this page.</p><div class="setup-facts">'+details+'</div>'+entry+'<button class="btn" '+(S.setupBusy?'disabled':'')+' onclick="Velora.checkSetupLicence()">'+(active?'Check again':'Activate licence')+'</button><p id="setup-action-status" class="small" role="status" aria-live="polite"></p></div>';
}
function setupHardwareStep(){
  var h=(S.setup&&S.setup.hardware)||S.system||{};var checked=!!(S.setup&&S.setup.hardwareChecked);
  return '<div class="setup-step-card '+(checked?'success-card':'')+'"><p class="eyebrow">Local hardware</p><h2>'+(checked?'Hardware detected':'Detect hardware')+'</h2><p class="lead">VeloraOS checks CPU, memory, graphics acceleration and available model storage.</p><div class="setup-facts">'+setupFact('CPU',h.cpu&&h.cpu.model)+setupFact('Memory',h.memory&&h.memory.total)+setupFact('Graphics',h.gpu&&h.gpu.name)+setupFact('Acceleration',h.acceleration)+setupFact('Free storage',h.storage&&h.storage.free)+'</div><button class="btn" '+(S.setupBusy?'disabled':'')+' onclick="Velora.runSetupHardware()">'+(checked?'Run detection again':'Run hardware detection')+'</button><p id="setup-action-status" class="small" role="status" aria-live="polite"></p></div>';
}
function setupOllamaStep(){
  var o=(S.setup&&S.setup.ollama)||{};var checked=!!(S.setup&&S.setup.ollamaChecked);var ready=!!o.ready;
  return '<div class="setup-step-card '+(ready?'success-card':(checked?'warning-card':''))+'"><p class="eyebrow">Local model runtime</p><h2>'+(ready?'Ollama is ready':'Test Ollama')+'</h2><p class="lead">This checks the local Ollama command, service and API without sending data outside your machine.</p>'+(checked?'<div class="setup-facts">'+setupFact('API',ready?'Responding':'Unavailable')+setupFact('Version',o.version||'Unknown')+setupFact('Service',o.serviceState||'Unknown')+setupFact('Installed models',String(o.installedModelCount||0))+'</div><p class="setup-callout">'+escapeHtml(o.message||'Test complete.')+'</p>':'')+'<button class="btn" '+(S.setupBusy?'disabled':'')+' onclick="Velora.runSetupOllama()">'+(checked?'Test again':'Run Ollama test')+'</button><p id="setup-action-status" class="small" role="status" aria-live="polite"></p></div>';
}
function setupModelStep(){
  var m=(S.setup&&S.setup.recommendation)||{};var installed=!!(S.setup&&(S.setup.modelInstalled||S.setup.anyModelInstalled));var skipped=!!(S.setup&&S.setup.modelSkipped);var d=S.setupDownload;
  var progress=d?'<div class="setup-download"><div class="progress"><span style="width:'+Math.max(0,Math.min(100,Number(d.progress||0)))+'%"></span></div><p>'+escapeHtml([d.downloaded&&d.total?(d.downloaded+' of '+d.total):'',d.speed,d.eta?('ETA '+d.eta):'',d.output||d.status].filter(Boolean).join(' · '))+'</p></div>':'';
  return '<div class="setup-step-card '+(installed?'success-card':(skipped?'warning-card':''))+'"><p class="eyebrow">Starter model</p><h2>'+(installed?'A model is installed':'Install your recommended model')+'</h2><p class="lead">VeloraOS selected a starter model based on detected RAM, acceleration and free storage.</p><div class="setup-model-recommend"><span class="tag">Recommended</span><h3>'+escapeHtml(m.name||'Starter model')+'</h3><p>'+escapeHtml(m.reason||'Recommended for this machine.')+'</p><div class="setup-facts">'+setupFact('Ollama tag',m.tag)+setupFact('Download',m.download)+setupFact('Category',m.kind)+'</div></div>'+progress+'<div class="setup-actions"><button class="btn" '+(S.setupBusy||installed?'disabled':'')+' onclick="Velora.installSetupModel()">'+(installed?'Installed':'Download model')+'</button><button class="btn ghost" '+(S.setupBusy||installed?'disabled':'')+' onclick="Velora.skipSetupModel()">Continue without model</button></div><p id="setup-action-status" class="small" role="status" aria-live="polite">'+(skipped?'Model download skipped. You can install one later from Models.':'')+'</p></div>';
}
function setupReadinessStep(){
  var x=S.setup||{};var blockers=x.blockers||[];var warnings=x.warnings||[];
  return '<div class="setup-step-card '+(x.ready?'success-card':'')+'"><p class="eyebrow">Final readiness test</p><h2>'+(x.ready?'VeloraOS is ready':'Finish the remaining setup checks')+'</h2><p class="lead">The final test verifies the required security, licence and local-runtime setup before opening the dashboard.</p><div class="readiness-list"><div><h3>Required checks</h3>'+(blockers.length?blockers.map(function(item){return '<p class="readiness-item blocked"><span>!</span>'+escapeHtml(item)+'</p>';}).join(''):'<p class="readiness-item ready"><span>✓</span>All required checks passed.</p>')+'</div>'+(warnings.length?'<div><h3>Warnings</h3>'+warnings.map(function(item){return '<p class="readiness-item warning"><span>•</span>'+escapeHtml(item)+'</p>';}).join('')+'</div>':'')+'</div><div class="setup-actions"><button class="btn ghost" '+(S.setupBusy?'disabled':'')+' onclick="Velora.runSetupReadiness()">Run readiness test</button><button class="btn" '+(!x.ready||S.setupBusy?'disabled':'')+' onclick="Velora.finishSetup()">Finish setup</button></div><p id="setup-action-status" class="small" role="status" aria-live="polite"></p></div>';
}
function setupStepContent(){return [null,setupPasswordStep,setupDeviceStep,setupLicenceStep,setupHardwareStep,setupOllamaStep,setupModelStep,setupReadinessStep][S.setupStep]();}
function setupDeviceDraftValue(){return String(S.setupDeviceDraft!==null?S.setupDeviceDraft:((S.setup&&S.setup.deviceName)||'')).trim();}
function setupCanContinue(){if(S.setupStep===2){var value=setupDeviceDraftValue();return !!value&&value!=='VeloraOS device';}return setupDone(S.setupStep);}
function setupPage(){
  var optional=S.setup&&S.setup.optionalRun&&!S.setup.required;
  return '<div class="setup-shell"><header class="setup-header"><div class="brand"><div class="logo">V</div><div><h1>VeloraOS</h1><p>First-run setup</p></div></div><div class="setup-header-copy"><span class="tag">VeloraOS 1.7.0</span><strong>Step '+S.setupStep+' of 7</strong></div>'+(optional?'<button class="btn ghost" onclick="Velora.cancelSetup()">Exit setup</button>':'')+'</header><main class="setup-main">'+setupStepsHtml()+'<section class="setup-content">'+setupStepContent()+'<div class="setup-footer"><button class="btn ghost" '+(S.setupStep<=1?'disabled':'')+' onclick="Velora.setupBack()">Back</button><button id="setup-continue" class="btn ghost" '+(S.setupStep>=7||!setupCanContinue()?'disabled':'')+' onclick="Velora.setupNext()">Continue</button></div></section></main></div>';
}
function afterSetupRender(){var target=document.querySelector('.setup-step-card input');if(target&&S.setupStep===1&&!setupDone(1))setTimeout(function(){target.focus();},0);}
function updateSetupDeviceDraft(value){S.setupDeviceDraft=String(value||'');var button=document.getElementById('setup-continue');if(button)button.disabled=S.setupStep>=7||!setupCanContinue();}
function setSetupStep(step){step=Math.max(1,Math.min(7,Number(step)||1));if(step>S.setupStep&&!setupDone(S.setupStep))return;S.setupStep=step;render();}
function setupBack(){if(S.setupStep>1){S.setupStep--;render();}}
function setupNext(){
  if(S.setupStep===2){var saved=String((S.setup&&S.setup.deviceName)||'').trim();var draft=setupDeviceDraftValue();if(!setupDone(2)||draft!==saved){saveSetupDeviceName(true);return;}}
  if(S.setupStep<7&&setupDone(S.setupStep)){S.setupStep++;render();}
}
async function refreshSetup(){await loadSetupStatus();S.license=S.setup&&S.setup.license?S.setup.license:S.license;}
async function changeSetupPassword(){
  var current=($('#setup-current-password')||{}).value||'';var next=($('#setup-new-password')||{}).value||'';var confirmValue=($('#setup-confirm-password')||{}).value||'';
  if(next!==confirmValue){setStatus('setup-action-status','The new passwords do not match.',true);return;}
  S.setupBusy=true;setStatus('setup-action-status','Changing password…',false);
  try{var result=await API.patch('/api/profile',{current_password:current,new_password:next});S.user=result.user;await refreshSetup();S.setupStep=2;render();}catch(error){setStatus('setup-action-status',humanError(error),true);}finally{S.setupBusy=false;}
}
async function saveSetupDeviceName(advance){
  var name=(($('#setup-device-name')||{}).value||S.setupDeviceDraft||'').trim();
  if(!name||name==='VeloraOS device'){setStatus('setup-action-status','Enter a name for this VeloraOS system.',true);return;}
  S.setupDeviceDraft=name;S.setupBusy=true;setStatus('setup-action-status','Saving device name…',false);
  try{
    var result=await API.post('/api/setup/device-name',{deviceName:name});
    await refreshSetup();S.setupDeviceDraft=result.deviceName||name;S.setupBusy=false;
    if(advance)S.setupStep=3;
    render();
    if(!advance)setStatus('setup-action-status',result.warning||'Device name saved. Continue is now available.',!!result.warning);
  }catch(error){S.setupBusy=false;setStatus('setup-action-status',humanError(error),true);}
}
async function checkSetupLicence(){
  var key=(($('#setup-license-key')||{}).value||'').toUpperCase().replace(/\s+/g,'');S.setupBusy=true;setStatus('setup-action-status','Checking licence…',false);
  try{S.license=key?await API.post('/api/license/activate',{licenseKey:key,deviceName:S.setup.deviceName}):await API.post('/api/license/recheck',{});await refreshSetup();if(S.setup.licenseReady)S.setupStep=4;render();}catch(error){setStatus('setup-action-status',licenseError(error),true);}finally{S.setupBusy=false;}
}
async function runSetupHardware(){S.setupBusy=true;setStatus('setup-action-status','Detecting hardware…',false);try{var result=await API.post('/api/setup/hardware-test',{});S.system=result.hardware;await refreshSetup();S.setupStep=5;render();}catch(error){setStatus('setup-action-status',humanError(error),true);}finally{S.setupBusy=false;}}
async function runSetupOllama(){S.setupBusy=true;setStatus('setup-action-status','Testing Ollama…',false);try{await API.post('/api/setup/ollama-test',{});await refreshSetup();S.setupStep=6;render();}catch(error){setStatus('setup-action-status',humanError(error),true);}finally{S.setupBusy=false;}}
async function installSetupModel(){
  var model=(S.setup&&S.setup.recommendation)||{};if(!model.id)return;S.setupBusy=true;S.setupDownload={status:'queued',progress:0,output:'Starting download…'};render();
  try{await API.post('/api/setup/model',{modelId:model.id,skipped:false});var start=await API.post('/api/models/'+encodeURIComponent(model.id)+'/install',{force:true,riskAccepted:true});for(var i=0;i<720;i++){await new Promise(function(resolve){setTimeout(resolve,1000);});var task=await API.get('/api/tasks/'+encodeURIComponent(start.task_id));S.setupDownload=task;render();var state=String(task.status||'').toLowerCase();if(['complete','completed','done','success'].indexOf(state)>=0){await refreshSetup();S.setupDownload=null;S.setupBusy=false;S.setupStep=7;render();return;}if(['error','failed'].indexOf(state)>=0)throw new Error(task.error||'Install failed');}throw new Error('The model download did not finish in time.');}
  catch(error){S.setupBusy=false;setStatus('setup-action-status',humanError(error),true);}
}
async function skipSetupModel(){S.setupBusy=true;try{await API.post('/api/setup/model',{modelId:(S.setup.recommendation||{}).id||null,skipped:true});await refreshSetup();S.setupStep=7;render();}catch(error){setStatus('setup-action-status',humanError(error),true);}finally{S.setupBusy=false;}}
async function runSetupReadiness(){S.setupBusy=true;setStatus('setup-action-status','Running final checks…',false);try{S.setup=await API.post('/api/setup/readiness',{});render();}catch(error){setStatus('setup-action-status',humanError(error),true);}finally{S.setupBusy=false;}}
async function finishSetup(){S.setupBusy=true;setStatus('setup-action-status','Finishing setup…',false);try{S.setup=await API.post('/api/setup/complete',{});await loadCore();if(S.user.role==='admin')await loadUpdateStatus();S.page='home';render();startUpdatePolling();}catch(error){setStatus('setup-action-status',humanError(error),true);}finally{S.setupBusy=false;}}
async function startSetupWizard(){try{await API.post('/api/setup/reset',{});await refreshSetup();await loadSetupCore();S.setupDeviceDraft=null;S.setupStep=1;S.page='setup';stopUpdatePolling();render();}catch(error){alert(humanError(error));}}
async function cancelSetup(){try{await API.post('/api/setup/cancel',{});await refreshSetup();S.page='settings';render();startUpdatePolling();}catch(error){alert(humanError(error));}}

function studioPage(title,lead,message){return '<div class="section-head"><div><p class="eyebrow">VeloraOS Studio</p><h2>'+escapeHtml(title)+'</h2><p class="lead">'+escapeHtml(lead)+'</p></div><button class="back" onclick="Velora.go(\'home\')">Back</button></div><div class="panel"><h3>'+escapeHtml(message)+'</h3><p class="muted">GPU readiness: '+escapeHtml(status())+'</p><button class="btn ghost" onclick="Velora.go(\'models\')">View compatible models</button></div>';}

function profileCard(){
  return '<div class="setting-card"><h3>My profile</h3><div class="profile-summary"><div id="profile-avatar-preview">'+avatarHtml(S.pendingAvatar===null?S.user:{avatar:S.pendingAvatar,display_name:S.user.display_name},'profile-avatar-large')+'</div><div><b>'+escapeHtml(S.user.display_name)+'</b><p class="muted small">@'+escapeHtml(S.user.username)+' · '+escapeHtml(S.user.role)+'</p></div></div><div class="field"><label>Display name</label><input id="profile-display-name" value="'+escapeHtml(S.user.display_name)+'" maxlength="60"></div><div class="field"><label>Profile picture</label><input id="profile-avatar-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onchange="Velora.selectProfilePicture(this.files)"></div><div class="profile-actions"><button class="btn ghost" onclick="Velora.removeProfilePicture()">Remove picture</button></div><div class="field"><label>Current password</label><input id="profile-current-password" type="password" autocomplete="current-password" placeholder="Only needed to change password"></div><div class="field"><label>New password</label><input id="profile-new-password" type="password" autocomplete="new-password" placeholder="At least 8 characters"></div><button class="btn" onclick="Velora.saveProfile()">Save profile</button><p class="small muted" id="profile-status"></p></div>';
}
function personalisationCard(){
  return '<div class="setting-card"><h3>Personalisation</h3><div class="field"><label>Background image URL</label><input id="setting-background" placeholder="https://..." value="'+escapeHtml(S.settings.background||'')+'"></div><div class="field"><label>Favicon URL</label><input id="setting-favicon" placeholder="https://..." value="'+escapeHtml(S.settings.favicon||'')+'"></div><div class="field"><label>Accent colour</label><input id="setting-accent" type="color" value="'+escapeHtml(/^#[0-9a-f]{6}$/i.test(S.settings.accent||'')?S.settings.accent:'#9b8cff')+'"></div><button class="btn" onclick="Velora.savePersonalisation()">Save personalisation</button><button class="btn ghost" onclick="Velora.resetPersonalisation()">Use Velora defaults</button><p class="small muted" id="personalisation-status"></p></div>';
}
function machineCard(){
  var system=S.system||{};
  return '<div class="setting-card"><h3>Your machine</h3><p class="muted">CPU: '+escapeHtml(system.cpu&&system.cpu.model?system.cpu.model:'Unknown')+'</p><p class="muted">Memory: '+escapeHtml(system.memory&&system.memory.total?system.memory.total:'Unknown')+'</p><p class="muted">Graphics: '+escapeHtml(system.gpu&&system.gpu.name?system.gpu.name:status())+'</p><p class="muted">Storage: '+escapeHtml(system.storage&&system.storage.free?system.storage.free:'Unknown')+'</p><button class="btn ghost" onclick="Velora.reload()">Recheck hardware</button></div>';
}
function setupSettingsCard(){
  if(!S.user||S.user.role!=='admin')return '';
  return '<div class="setting-card"><p class="eyebrow">Onboarding</p><h3>First-run setup</h3><p class="muted">Re-run the guided password, licence, hardware, Ollama, starter-model and readiness checks.</p><button class="btn ghost" onclick="Velora.startSetupWizard()">Run setup wizard</button></div>';
}
function accountRow(account){
  var id=account.id;var isSelf=S.user&&S.user.id===id;
  return '<div class="account-row"><div class="account-identity">'+avatarHtml(account,'account-avatar')+'<div><b>'+escapeHtml(account.display_name)+'</b><span>@'+escapeHtml(account.username)+'</span></div></div><div class="account-editor"><input id="account-username-'+id+'" value="'+escapeHtml(account.username)+'" aria-label="Username"><input id="account-name-'+id+'" value="'+escapeHtml(account.display_name)+'" aria-label="Display name"><select id="account-role-'+id+'" aria-label="Role"><option value="user" '+(account.role==='user'?'selected':'')+'>User</option><option value="admin" '+(account.role==='admin'?'selected':'')+'>Admin</option></select><input id="account-password-'+id+'" type="password" placeholder="New password (optional)" autocomplete="new-password"><button class="btn ghost" onclick="Velora.updateAccount(\''+id+'\')">Save</button><button class="danger-button" '+(isSelf?'disabled title="You cannot delete the active account"':'')+' onclick="Velora.deleteAccount(\''+id+'\')">Delete</button></div></div>';
}
function accountsCard(){
  if(!S.user||S.user.role!=='admin')return '';
  return '<div class="setting-card account-manager"><div class="account-manager-head"><div><h3>Accounts</h3><p class="muted">Create separate logins. Each account gets its own chats, profile picture and personalisation; installed Ollama models stay shared.</p></div><span class="tag">Administrator</span></div><div class="create-account"><input id="new-account-username" placeholder="Username"><input id="new-account-name" placeholder="Display name"><input id="new-account-password" type="password" placeholder="Temporary password" autocomplete="new-password"><select id="new-account-role"><option value="user">User</option><option value="admin">Admin</option></select><button class="btn" onclick="Velora.createAccount()">Create account</button></div><p class="small muted" id="account-status"></p><div class="account-list">'+(S.accounts.length?S.accounts.map(accountRow).join(''):'<p class="muted">No accounts loaded.</p>')+'</div></div>';
}
function licenseStateLabel(value){
  var state=String(value||'unconfigured');
  return {active:'Active',trial:'Trial',expired:'Expired',inactive:'Inactive',offline:'Offline',offline_grace:'Offline grace',error:'Error',unconfigured:'Not configured'}[state]||state;
}
function licenseDate(value){if(!value)return 'Not supplied';try{return new Date(value).toLocaleString();}catch(_){return String(value);}}
function licensingCard(){
  var l=S.license||{configured:false,status:'unconfigured',connectionState:'offline'};
  var admin=S.user&&S.user.role==='admin';
  var state=String(l.status||'unconfigured').replace(/[^a-z_]/g,'');
  var plan=l.planName||'No active plan';
  var statusText=licenseStateLabel(state);
  var message=l.message||(
    l.connectionState==='offline'?'VeloraOS could not contact the licensing service. Check your connection and retry.':
    state==='expired'||state==='inactive'?'This licence is inactive or has expired.':
    state==='offline_grace'?'The licensing service is offline. VeloraOS is temporarily using the last successful entitlement check.':
    l.activated?'Your VeloraOS entitlement is active.':'Enter a licence key to activate this installation.'
  );
  var details='<div class="license-summary"><div><span class="license-status '+escapeHtml(state)+'">'+escapeHtml(statusText)+'</span><h3>'+escapeHtml(plan)+'</h3><p class="muted">'+escapeHtml(message)+'</p></div><div class="license-orb" aria-hidden="true">✦</div></div>'+
    '<dl class="license-details"><div><dt>Licence</dt><dd>'+escapeHtml(l.maskedKey||'Not configured')+'</dd></div><div><dt>Device</dt><dd>'+escapeHtml(l.deviceName||'Not configured')+'</dd></div><div><dt>Device limit</dt><dd>'+escapeHtml(l.deviceLimit==null?'Not supplied':l.deviceLimit)+'</dd></div><div><dt>Expiry / renewal</dt><dd>'+escapeHtml(l.expiresAt?licenseDate(l.expiresAt):'No expiry supplied')+'</dd></div><div><dt>Last successful check</dt><dd>'+escapeHtml(l.lastCheckedAt?licenseDate(l.lastCheckedAt):'Never')+'</dd></div><div><dt>Connection</dt><dd>'+escapeHtml(l.connectionState||'unknown')+'</dd></div></dl>';
  var actions='<a class="btn ghost license-account-link" href="https://www.veloraos.co.uk/account" target="_blank" rel="noopener noreferrer">Manage devices online</a>';
  if(admin){
    actions+='<div class="license-entry"><div class="field"><label for="license-key-input">Licence key</label><div class="license-key-row"><input id="license-key-input" '+(S.showLicenseKey?'type="text"':'type="password"')+' autocomplete="off" spellcheck="false" placeholder="VLOS-XXXX-XXXX-XXXX-XXXX-XXXX" aria-describedby="license-help"><button class="btn ghost" type="button" onclick="Velora.toggleLicenseKey()" aria-label="'+(S.showLicenseKey?'Hide':'Show')+' licence key">'+(S.showLicenseKey?'Hide':'Show')+'</button></div><p id="license-help" class="small muted">The full key is sent only to the local privileged backend and is never returned after activation.</p></div><div class="field"><label for="license-device-name">Device name</label><input id="license-device-name" value="'+escapeHtml(l.deviceName||((S.user&&S.user.display_name)||'VeloraOS')+'\'s VeloraOS')+'" maxlength="120"></div></div>';
    actions+='<div class="license-actions"><button class="btn" '+(S.licenseBusy?'disabled':'')+' onclick="Velora.activateLicense()">'+(l.configured?'Change licence':'Activate')+'</button>';
    if(l.configured)actions+='<button class="btn ghost" '+(S.licenseBusy?'disabled':'')+' onclick="Velora.recheckLicense()">Retry check</button><button class="danger-button" '+(S.licenseBusy?'disabled':'')+' onclick="Velora.deactivateLicense()">Deactivate this device</button>';
    actions+='</div><p class="small" id="license-action-status" role="status" aria-live="polite"></p>';
  }
  return '<section class="setting-card licensing-card" aria-labelledby="licensing-title"><div class="account-manager-head"><div><p class="eyebrow">Entitlement</p><h3 id="licensing-title">Licensing</h3></div><span class="tag">Secure local service</span></div>'+details+actions+'</section>';
}
function licenseError(error){var data=error&&error.data&&error.data.detail?error.data.detail:(error&&error.data)||{};var code=data.code||data.error;return {invalid_license:'That licence key format is not valid.',license_inactive:'This licence is inactive or has expired.',activation_limit_reached:'This licence has reached its device limit. Deactivate another device from your VeloraOS account.',rate_limited:'Too many attempts. Wait a minute and try again.',network_failure:'VeloraOS could not contact the licensing service. Check your connection and retry.'}[code]||humanError(error);}
function toggleLicenseKey(){S.showLicenseKey=!S.showLicenseKey;render();var input=$('#license-key-input');if(input)input.focus();}
async function activateLicense(){
  var key=(($('#license-key-input')||{}).value||'').toUpperCase().replace(/\s+/g,'');var name=(($('#license-device-name')||{}).value||'').trim();
  if(S.license&&S.license.configured&&!key&&!confirm('Retry the currently stored licence on this device?'))return;
  if(S.license&&S.license.configured&&key&&!confirm('Changing the licence will replace the stored key after the new licence activates successfully. Continue?'))return;
  S.licenseBusy=true;setStatus('license-action-status','Contacting the licensing service…',false);
  try{S.license=await API.post('/api/license/activate',{licenseKey:key||null,deviceName:name||null});setStatus('license-action-status','Licence activated successfully.',false);S.showLicenseKey=false;render();}
  catch(error){setStatus('license-action-status',licenseError(error),true);}finally{S.licenseBusy=false;}
}
async function recheckLicense(){S.licenseBusy=true;setStatus('license-action-status','Checking entitlement…',false);try{S.license=await API.post('/api/license/recheck',{});setStatus('license-action-status','Entitlement refreshed.',false);render();}catch(error){setStatus('license-action-status',licenseError(error),true);}finally{S.licenseBusy=false;}}
async function deactivateLicense(){if(!confirm('Deactivate this VeloraOS device? It will stop using a device slot, and this installation will require activation again.'))return;S.licenseBusy=true;setStatus('license-action-status','Deactivating device…',false);try{S.license=await API.post('/api/license/deactivate',{});setStatus('license-action-status','This device has been deactivated.',false);render();}catch(error){setStatus('license-action-status',licenseError(error),true);}finally{S.licenseBusy=false;}}

function settingsPage(){
  return '<div class="section-head"><div><p class="eyebrow">Settings</p><h2>Settings</h2><p class="lead">Profiles, separate user accounts, personalisation and system details.</p></div><button class="back" onclick="Velora.go(\'home\')">Back</button></div><div class="settings-grid">'+profileCard()+personalisationCard()+machineCard()+setupSettingsCard()+licensingCard()+accountsCard()+'</div>';
}
function upgradesPage(){
  var items=['Hermes Agent','More model support','Apple M-series support','Full ISO image','Advanced account permissions','Better image/video engine manager'];
  return '<div class="section-head"><div><p class="eyebrow">Upcoming</p><h2>V2 is being developed</h2><p class="lead">Being implemented features for the next major build.</p></div><button class="back" onclick="Velora.go(\'home\')">Back</button></div><div class="cards">'+items.map(function(item){return '<div class="model-card"><span class="tag">Being implemented</span><h3>'+escapeHtml(item)+'</h3><p class="muted">Planned for a future VeloraOS release.</p></div>';}).join('')+'</div>';
}

function formatUpdateDate(value){if(!value)return 'Not checked';try{return new Date(value).toLocaleString();}catch(_){return String(value);}}
function updateStageLabel(value){return {idle:'Up to date',checking:'Checking',available:'Available',downloading:'Downloading',installing:'Installing',complete:'Complete',failed:'Failed'}[value]||'Unknown';}
function updateActionsHtml(){
  var update=S.update||{};var running=updateIsRunning();var installable=!!update.updateAvailable&&!running;
  if(update.state==='complete'){
    if(update.rebootRequired)return '<button class="btn" onclick="Velora.confirmReboot()">Reboot system</button>';
    return '<button class="btn" onclick="Velora.restartWebUi()">Restart Web UI</button>';
  }
  return '<button class="btn ghost" onclick="Velora.checkForUpdates()" '+(running?'disabled':'')+'>Check again</button><button class="btn" onclick="Velora.openUpdateModal()" '+(installable?'':'disabled')+'>Install update</button>';
}
function updatesPage(){
  var update=S.update||{state:'idle',installedVersion:'Unknown',releaseNotes:[]};var notes=(update.releaseNotes||[]).map(function(note){return '<li>'+escapeHtml(note)+'</li>';}).join('')||'<li>No release notes supplied.</li>';
  var statusClass='update-status status-'+escapeHtml(update.state||'idle');
  return '<div class="section-head"><div><p class="eyebrow">System updates</p><h2>Updates</h2><p class="lead">Verified VeloraOS updates from the official GitHub update channel.</p></div><button class="back" onclick="Velora.go(\'home\')">Back</button></div><div class="update-layout"><section class="panel update-panel"><div class="update-panel-head"><div><span class="'+statusClass+'"><span></span>'+escapeHtml(updateStageLabel(update.state))+'</span><h3>'+escapeHtml(update.title||'VeloraOS update status')+'</h3><p class="muted">'+escapeHtml(update.message||'No update check has run yet.')+'</p></div><div class="update-actions">'+updateActionsHtml()+'</div></div><div class="update-facts"><div><small>Installed</small><strong>'+escapeHtml(update.installedVersion||'Unknown')+'</strong></div><div><small>Latest</small><strong>'+escapeHtml(update.latestVersion||'Not checked')+'</strong></div><div><small>Last checked</small><strong>'+escapeHtml(formatUpdateDate(update.lastCheckedAt))+'</strong></div><div><small>Released</small><strong>'+escapeHtml(formatUpdateDate(update.publishedAt))+'</strong></div><div><small>Restart</small><strong>'+(update.rebootRequired?'System reboot':'Web UI restart')+'</strong></div></div><div class="release-notes"><h3>Release notes</h3><ul>'+notes+'</ul></div>'+(update.error?'<div class="update-error" role="alert">'+escapeHtml(update.error)+'</div>':'')+'</section><section class="panel update-log-panel"><div class="update-log-head"><div><p class="eyebrow">Sanitised log</p><h3>Update activity</h3></div><button class="btn ghost compact" onclick="Velora.loadUpdateStatus().then(Velora.render)">Refresh</button></div><pre class="update-log" tabindex="0">'+escapeHtml((update.log||[]).join('\n')||'No update activity yet.')+'</pre></section></div><div id="update-live" class="sr-only" aria-live="polite"></div>';
}
function updateModalHtml(){
  if(!S.updateModal)return '';
  var update=S.update||{};
  return '<div class="modal-backdrop" onclick="if(event.target===this)Velora.closeUpdateModal()"><section class="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="update-modal-title" aria-describedby="update-modal-description"><h3 id="update-modal-title">Install '+escapeHtml(update.title||('VeloraOS '+(update.latestVersion||'')))+'?</h3><p id="update-modal-description">VeloraOS will verify the SHA-256 checksum again, run a syntax check, then install through the dedicated update service. Your data, licence, device identity and settings are preserved.</p><div class="modal-actions"><button class="btn ghost" onclick="Velora.closeUpdateModal()">Cancel</button><button id="confirm-update-button" class="btn" onclick="Velora.installUpdate()">Install update</button></div></section></div>';
}
function afterUpdateRender(){
  if(S.updateModal){var button=document.getElementById('confirm-update-button');if(button)setTimeout(function(){button.focus();},0);}
  announceUpdate((S.update&&S.update.message)||'');
}
function dismissUpdateNotice(){if(S.update&&S.update.latestVersion)localStorage.setItem(updateDismissKey(),'1');render();}
async function checkForUpdates(){S.updateBusy=true;announceUpdate('Checking for updates.');try{S.update=await API.post('/api/update/check',{});}catch(error){S.update=Object.assign({},S.update||{},{state:'failed',error:humanError(error),message:humanError(error)});}finally{S.updateBusy=false;render();startUpdatePolling();}}
function openUpdateModal(){if(!S.update||!S.update.updateAvailable||updateIsRunning())return;S.updateModal=true;render();}
function closeUpdateModal(){S.updateModal=false;render();}
async function installUpdate(){S.updateModal=false;S.updateBusy=true;announceUpdate('Starting update installation.');render();try{S.update=await API.post('/api/update/install',{});}catch(error){S.update=Object.assign({},S.update||{},{state:'failed',error:humanError(error),message:humanError(error)});}finally{S.updateBusy=false;render();startUpdatePolling();}}
function restartWebUi(){window.location.href='/app?updated='+Date.now();}
function confirmReboot(){if(!window.confirm('Reboot this VeloraOS system now to finish the update?'))return;API.post('/api/update/reboot',{}).then(function(){announceUpdate('System reboot started.');}).catch(function(error){alert(humanError(error));});}

async function loadAccounts(){
  if(!S.user||S.user.role!=='admin'){S.accounts=[];return;}
  try{var data=await API.get('/api/accounts');S.accounts=data.accounts||[];}catch(error){S.accounts=[];if(error.status===401)showLogin('Your session expired.');}
}
function setStatus(id,text,isError){var element=document.getElementById(id);if(element){element.textContent=text||'';element.classList.toggle('error-text',!!isError);}}
function selectProfilePicture(files){
  var file=files&&files[0];if(!file)return;
  if(['image/png','image/jpeg','image/webp','image/gif'].indexOf(file.type)<0){alert('Use a PNG, JPEG, WebP or GIF image.');return;}
  if(file.size>2*1024*1024){alert('Profile pictures must be 2 MB or smaller.');return;}
  var reader=new FileReader();reader.onload=function(){S.pendingAvatar=String(reader.result);var preview=$('#profile-avatar-preview');if(preview)preview.innerHTML=avatarHtml({avatar:S.pendingAvatar,display_name:S.user.display_name},'profile-avatar-large');};reader.readAsDataURL(file);
}
function removeProfilePicture(){S.pendingAvatar='';var preview=$('#profile-avatar-preview');if(preview)preview.innerHTML=avatarHtml({avatar:'',display_name:S.user.display_name},'profile-avatar-large');}
async function saveProfile(){
  var body={display_name:($('#profile-display-name')||{}).value||S.user.display_name};
  if(S.pendingAvatar!==null)body.avatar=S.pendingAvatar;
  var current=($('#profile-current-password')||{}).value||'';var next=($('#profile-new-password')||{}).value||'';
  if(next){body.current_password=current;body.new_password=next;}
  setStatus('profile-status','Saving...',false);
  try{var result=await API.patch('/api/profile',body);S.user=result.user;S.pendingAvatar=null;if(S.user.role==='admin')await loadAccounts();setStatus('profile-status','Profile saved.',false);render();}
  catch(error){setStatus('profile-status',humanError(error),true);}
}
async function savePersonalisation(){
  var settings=Object.assign({},S.settings,{background:($('#setting-background')||{}).value||'',favicon:($('#setting-favicon')||{}).value||'',accent:($('#setting-accent')||{}).value||'#9b8cff',browser_personalisation_migrated:true});
  setStatus('personalisation-status','Saving...',false);
  try{await API.post('/api/settings',{settings:settings});S.settings=settings;applyPersonalisation();setStatus('personalisation-status','Personalisation saved.',false);}
  catch(error){setStatus('personalisation-status',humanError(error),true);}
}
async function resetPersonalisation(){
  S.settings=Object.assign({},S.settings,{background:'',favicon:'',accent:'#9b8cff',browser_personalisation_migrated:true});
  try{await API.post('/api/settings',{settings:S.settings});applyPersonalisation();render();}catch(error){alert(humanError(error));}
}
async function createAccount(){
  var body={username:($('#new-account-username')||{}).value||'',display_name:($('#new-account-name')||{}).value||'',password:($('#new-account-password')||{}).value||'',role:($('#new-account-role')||{}).value||'user'};
  setStatus('account-status','Creating account...',false);
  try{await API.post('/api/accounts',body);await loadAccounts();setStatus('account-status','Account created.',false);render();}
  catch(error){setStatus('account-status',humanError(error),true);}
}
async function updateAccount(id){
  var body={username:($('#account-username-'+id)||{}).value||'',display_name:($('#account-name-'+id)||{}).value||'',role:($('#account-role-'+id)||{}).value||'user'};
  var password=($('#account-password-'+id)||{}).value||'';if(password)body.password=password;
  setStatus('account-status','Saving account...',false);
  try{var result=await API.patch('/api/accounts/'+encodeURIComponent(id),body);if(S.user.id===id)S.user=result.account;await loadAccounts();setStatus('account-status','Account saved.',false);render();}
  catch(error){setStatus('account-status',humanError(error),true);}
}
async function deleteAccount(id){
  var account=S.accounts.find(function(item){return item.id===id;});
  if(!account||!confirm('Delete '+account.display_name+'? Their data will be archived on the server.'))return;
  setStatus('account-status','Deleting account...',false);
  try{await API.del('/api/accounts/'+encodeURIComponent(id));await loadAccounts();setStatus('account-status','Account deleted and its data archived.',false);render();}
  catch(error){setStatus('account-status',humanError(error),true);}
}
async function reload(){await loadCore();render();}

function showLogin(message){
  S.user=null;S.accounts=[];
  var app=$('#app');if(!app)return;
  app.innerHTML='<div class="shell"><main class="main login-main"><div class="panel login-card"><div class="brand login-brand"><div class="logo">V</div><div><h1>VeloraOS</h1><p>Sign in to your local AI appliance</p></div></div>'+(message?'<div class="login-error">'+escapeHtml(message)+'</div>':'')+'<div class="field"><label>Username</label><input id="login-username" value="admin" autocomplete="username"></div><div class="field"><label>Password</label><input id="login-password" type="password" placeholder="Password" autocomplete="current-password" onkeydown="if(event.key===\'Enter\')Velora.doLogin()"></div><button class="btn login-button" id="login-button" onclick="Velora.doLogin()">Login</button><p class="muted small">Fresh installs start as <b>admin</b> / <b>veloraos</b> and immediately require a new password.</p><p class="small" id="login-status"></p></div></main></div>';
}
async function doLogin(){
  var username=($('#login-username')||{}).value||'';var password=($('#login-password')||{}).value||'';var button=$('#login-button');if(button)button.disabled=true;setStatus('login-status','Signing in...',false);
  try{var result=await API.post('/api/auth/login',{username:username,password:password});localStorage.removeItem('velora_session');await startAuthenticated(result.user,result.csrfToken);}
  catch(error){setStatus('login-status',humanError(error),true);if(button)button.disabled=false;}
}
async function logout(){
  try{await API.post('/api/auth/logout',{});}catch(_){ }
  stopUpdatePolling();S.user=null;S.csrf='';S.license=null;S.update=null;S.setup=null;S.setupDeviceDraft=null;S.settings={};S.chats=[];S.msgs=[];S.active=null;showLogin('You have been signed out.');
}
async function startAuthenticated(user,csrfToken){
  S.user=user;S.csrf=csrfToken||S.csrf||'';S.pendingAvatar=null;S.setupDeviceDraft=null;
  try{
    await loadSettings();await loadLicense();if(user&&user.role==='admin')await loadSetupStatus();
    if(S.setup&&S.setup.required){await loadSetupCore();S.setupStep=S.setup.suggestedStep||1;S.page='setup';render();return;}
    await loadCore();if(user&&user.role==='admin')await loadUpdateStatus();
  }
  catch(error){if(error.status===401){showLogin('Your session expired.');return;}throw error;}
  if(!S.chats.length){var id=(window.crypto&&crypto.randomUUID)?crypto.randomUUID():String(Date.now());S.active=id;S.chats=[{id:id,title:'New chat',model:S.selected,messages:[]}];S.msgs=[];await saveChats();}
  else{var chat=S.chats[0];S.active=chat.id;S.msgs=chat.messages||[];S.selected=chat.model||S.selected;}
  S.page='home';render();startUpdatePolling();
}
async function boot(){
  try{var result=await API.get('/api/auth/me');await startAuthenticated(result.user,result.csrfToken);}
  catch(error){if(error.status===401){showLogin();return;}fatal(humanError(error));}
}

window.Velora={
  go:go,installModel:installModel,deleteModel:deleteModel,refreshDiagnostics:refreshDiagnostics,runAccelerationTest:runAccelerationTest,newChat:newChat,openChat:openChat,deleteChat:deleteChat,renameChat:renameChat,exportChat:exportChat,copyMessage:copyMessage,copyCode:copyCode,beginEditMessage:beginEditMessage,cancelEditMessage:cancelEditMessage,regenerateMessage:regenerateMessage,setSearch:setSearch,toggleModelMenu:toggleModelMenu,selectModel:selectModel,send:send,stopGeneration:stopGeneration,toggleCosmicReasoning:toggleCosmicReasoning,previewCosmicReasoning:previewCosmicReasoning,commitCosmicReasoning:commitCosmicReasoning,
  reload:reload,logout:logout,doLogin:doLogin,openImagePicker:openImagePicker,handleImageFiles:handleImageFiles,removePendingImage:removePendingImage,
  selectProfilePicture:selectProfilePicture,removeProfilePicture:removeProfilePicture,saveProfile:saveProfile,savePersonalisation:savePersonalisation,resetPersonalisation:resetPersonalisation,
  createAccount:createAccount,updateAccount:updateAccount,deleteAccount:deleteAccount,toggleLicenseKey:toggleLicenseKey,activateLicense:activateLicense,recheckLicense:recheckLicense,deactivateLicense:deactivateLicense,loadUpdateStatus:loadUpdateStatus,checkForUpdates:checkForUpdates,openUpdateModal:openUpdateModal,closeUpdateModal:closeUpdateModal,installUpdate:installUpdate,dismissUpdateNotice:dismissUpdateNotice,restartWebUi:restartWebUi,confirmReboot:confirmReboot,setSetupStep:setSetupStep,setupBack:setupBack,setupNext:setupNext,updateSetupDeviceDraft:updateSetupDeviceDraft,changeSetupPassword:changeSetupPassword,saveSetupDeviceName:saveSetupDeviceName,checkSetupLicence:checkSetupLicence,runSetupHardware:runSetupHardware,runSetupOllama:runSetupOllama,installSetupModel:installSetupModel,skipSetupModel:skipSetupModel,runSetupReadiness:runSetupReadiness,finishSetup:finishSetup,startSetupWizard:startSetupWizard,cancelSetup:cancelSetup,render:render
};

boot();
})();

window.VELORAOS_RELEASE="1.7.0";

