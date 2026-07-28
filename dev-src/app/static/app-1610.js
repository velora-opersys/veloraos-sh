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
  busy:false,error:'',search:'',pendingImages:[],user:null,settings:{},accounts:[],pendingAvatar:null,controller:null,stopRequested:false,reasoning:2,reasoningOpen:false,csrf:'',license:null,licenseBusy:false,showLicenseKey:false,update:null,updateBusy:false,updateModal:false,updatePoll:null,updateAnnounced:''
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
  return '<div class="top'+(maximum?' cosmic-maximum':'')+'"><div class="brand"><div class="logo">V</div><div><h1>VeloraOS</h1><p>'+escapeHtml((S.user&&S.user.display_name)||'User')+'\'s local AI appliance</p></div></div><div id="cosmic-header-badge" class="cosmic-header-badge" '+(maximum?'':'hidden')+'><span>✦</span> Maximum Power</div><div class="nav"><button class="'+(S.page==='home'?'active':'')+'" onclick="Velora.go(\'home\')">Home</button><button class="'+(S.page==='models'?'active':'')+'" onclick="Velora.go(\'models\')">Models</button>'+updateButton+'<button class="'+(S.page==='upgrades'?'active':'')+'" onclick="Velora.go(\'upgrades\')">Upgrades</button><span class="pill"><span class="dot"></span>'+escapeHtml(status())+'</span><button class="top-profile" onclick="Velora.go(\'settings\')">'+avatarHtml(S.user,'top-avatar')+'<span>'+escapeHtml((S.user&&S.user.display_name)||'Profile')+'</span></button><button onclick="Velora.logout()">Logout</button></div></div>';
}
function shell(content){return '<div class="shell">'+top()+'<main class="main">'+content+'</main></div>';}
async function go(page){
  S.page=page;S.error='';
  if(page==='settings'){await loadLicense();if(S.user&&S.user.role==='admin')await loadAccounts();}
  if(page==='updates'&&S.user&&S.user.role==='admin')await loadUpdateStatus();
  render();
}
function render(){
  var app=$('#app');if(!app)return;
  if(!S.user){showLogin();return;}
  if(S.page==='chat'){app.innerHTML=chatPage();afterChat();return;}
  if(S.page==='models'){app.innerHTML=shell(modelsPage());return;}
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

function chatPage(){
  return '<div class="shell">'+top()+'<div class="chat-wrap"><aside class="chat-sidebar"><button class="new-chat" onclick="Velora.newChat()">+ New chat</button><input class="search" placeholder="Search chats" value="'+escapeHtml(S.search)+'" oninput="Velora.setSearch(this.value)"><div class="chat-list">'+filteredChats().map(function(chat){return '<div class="chat-row '+(S.active===chat.id?'active':'')+'"><button class="chat-item" onclick="Velora.openChat(\''+chat.id+'\')">'+escapeHtml(chat.title||'New chat')+'</button><button class="chat-delete" onclick="Velora.deleteChat(\''+chat.id+'\')" aria-label="Delete '+escapeHtml(chat.title||'chat')+'" title="Delete chat">×</button></div>';}).join('')+'</div></aside><section class="chat-main"><div class="chat-top"><div class="chat-top-title">'+escapeHtml(currentTitle())+'</div><div class="model-picker"><button class="model-button" onclick="Velora.toggleModelMenu()">'+escapeHtml(modelName(S.selected))+' ▾</button><div class="model-menu '+(S.menu?'open':'')+'">'+allModels().map(function(model){return '<button class="model-option" onclick="Velora.selectModel(\''+escapeHtml(model.id)+'\')"><b>'+escapeHtml(model.name)+'</b><small>'+escapeHtml(model.kind)+'</small></button>';}).join('')+'</div></div></div><div class="messages" id="messages"><div class="messages-inner" id="messages-inner">'+(S.error?'<div class="chat-error">'+escapeHtml(S.error)+'</div>':'')+(S.msgs.length?S.msgs.map(messageHtml).join(''):emptyChat())+'</div></div><div class="composer-wrap"><div class="composer-stack"><div class="composer-toolbar"><div class="composer-toolbar-left"><button class="upload-btn" type="button" onclick="Velora.openImagePicker()">Upload image</button><input id="image-input" type="file" accept="image/*" multiple hidden><span class="vision-chip">Paste images straight into chat · use Moondream/LLaVA for vision</span></div><div class="composer-toolbar-right">'+cosmicReasoningHtml()+'</div></div>'+pendingImagesHtml()+'<div class="composer"><textarea id="prompt" placeholder="Message VeloraOS or paste an image..." rows="1"></textarea><button class="send" id="send-btn" onclick="Velora.send()">➜</button></div><div class="hint">Enter to send · Shift+Enter for a new line · paste from clipboard or upload · up to 4 images, 5 MB each</div></div></div></section></div></div>';
}
function afterChat(){
  var input=$('#prompt');
  if(input){input.addEventListener('input',function(){this.style.height='auto';this.style.height=Math.min(this.scrollHeight,180)+'px';});input.addEventListener('keydown',function(event){if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();send();}});input.addEventListener('paste',handlePaste);}
  var picker=$('#image-input');if(picker){picker.addEventListener('change',function(event){Velora.handleImageFiles(event.target.files);this.value='';});}
  scrollChat();
}
function scrollChat(){var box=$('#messages');if(box)box.scrollTop=box.scrollHeight;}
function filteredChats(){var query=S.search.toLowerCase().trim();return S.chats.filter(function(chat){return !query||String(chat.title||'').toLowerCase().indexOf(query)>=0;});}
function currentTitle(){var chat=S.chats.find(function(item){return item.id===S.active;});return chat&&chat.title?chat.title:'New chat';}
function modelName(id){var model=allModels().find(function(item){return item.id===id;});return model?model.name:id;}
function emptyChat(){return '<div class="empty-chat"><div class="empty-orb">'+icons.chat+'</div><h2>How can I help?</h2><p>Choose any installed model and ask anything. This private chat workspace is custom-built for VeloraOS.</p></div>';}
function messageHtml(message){return '<div class="msg">'+chatAvatar(message.role)+'<div><div class="msg-role">'+(message.role==='user'?escapeHtml((S.user&&S.user.display_name)||'You'):'VeloraOS')+'</div><div class="msg-body">'+imageStrip(message.images)+escapeHtml(message.content||'')+'</div></div></div>';}
function setSearch(value){S.search=value;render();}
function toggleModelMenu(){S.menu=!S.menu;render();}
function selectModel(id){S.selected=id;S.menu=false;saveActive();render();}
function newChat(){var id=(window.crypto&&crypto.randomUUID)?crypto.randomUUID():String(Date.now());S.active=id;S.msgs=[];S.pendingImages=[];S.error='';S.chats=[{id:id,title:'New chat',model:S.selected,messages:[]}].concat(S.chats);saveChats();render();}
function openChat(id){var chat=S.chats.find(function(item){return item.id===id;});if(!chat)return;S.active=id;S.msgs=chat.messages||[];S.selected=chat.model||S.selected;S.pendingImages=[];S.error='';render();}
async function deleteChat(id){
  var chat=S.chats.find(function(item){return item.id===id;});if(!chat)return;
  if(!window.confirm('Delete “'+(chat.title||'New chat')+'”? This cannot be undone.'))return;
  S.chats=S.chats.filter(function(item){return item.id!==id;});
  if(S.active===id){
    var next=S.chats[0]||null;
    if(next){S.active=next.id;S.msgs=next.messages||[];S.selected=next.model||S.selected;}
    else{S.active=null;S.msgs=[];}
    S.pendingImages=[];S.error='';
  }
  await saveChats();
  render();
}
async function saveChats(){localStorage.setItem(localChatKey(),JSON.stringify(S.chats));try{await API.post('/api/chats',{chats:S.chats});}catch(error){if(error.status===401)showLogin('Your session expired.');}}
function saveActive(){var chat=S.chats.find(function(item){return item.id===S.active;});if(!chat)return saveChats();chat.messages=S.msgs;chat.model=S.selected;chat.title=(S.msgs.find(function(message){return message.role==='user';})||{}).content||chat.title||'New chat';if(chat.title.length>42)chat.title=chat.title.slice(0,42);saveChats();}
function createMessageElement(message){
  var div=document.createElement('div');div.className='msg';div.innerHTML=chatAvatar(message.role)+'<div><div class="msg-role">'+(message.role==='user'?escapeHtml((S.user&&S.user.display_name)||'You'):'VeloraOS')+'</div><div class="msg-body"></div></div>';
  var body=div.querySelector('.msg-body');if(message.images&&message.images.length)body.insertAdjacentHTML('beforeend',imageStrip(message.images));if(message.content)body.appendChild(document.createTextNode(message.content));return {root:div,body:body};
}
async function stopGeneration(){
  if(!S.busy)return;
  S.stopRequested=true;
  if(S.controller)S.controller.abort();
  var model=allModels().find(function(item){return item.id===S.selected;});
  try{await API.post('/api/chat/stop',{model:model&&model.tag?model.tag:S.selected,model_id:S.selected});}catch(_){ }
}
async function send(){
  var input=$('#prompt');var prompt=input&&input.value.trim();var queued=S.pendingImages.slice();if((!prompt&&!queued.length)||S.busy)return;
  if(!S.active)newChat();var effectivePrompt=prompt||('Please describe the uploaded image'+(queued.length>1?'s.':'.'));
  if(input){input.value='';input.style.height='50px';}
  S.pendingImages=[];S.busy=true;S.stopRequested=false;S.controller=new AbortController();S.error='';var userMessage={role:'user',content:effectivePrompt,images:queued};S.msgs.push(userMessage);saveActive();
  var wrap=$('#messages-inner');if(wrap&&wrap.querySelector('.empty-chat'))wrap.innerHTML='';if(!wrap){render();return;}
  var userNode=createMessageElement(userMessage);wrap.appendChild(userNode.root);
  var assistantNode=createMessageElement({role:'assistant',content:'',images:[]});assistantNode.body.innerHTML='<span class="typing"><span></span><span></span><span></span></span>';wrap.appendChild(assistantNode.root);scrollChat();
  var button=$('#send-btn');if(button){button.disabled=false;button.textContent='■';button.classList.add('stop');button.onclick=stopGeneration;button.title='Stop generation';}
  var saved=false;
  try{
    var model=allModels().find(function(item){return item.id===S.selected;});
    var response=await API.post('/api/chat',{model:model&&model.tag?model.tag:S.selected,model_id:S.selected,messages:serializableMessages(),prompt:effectivePrompt,reasoning_power:S.reasoning},S.controller.signal);
    var text=response.response||response.message||response.content||'No response returned.';assistantNode.body.textContent='';var shown='';
    for(var i=0;i<text.length;i++){if(S.stopRequested)break;shown+=text[i];assistantNode.body.textContent=shown;if(i%4===0){scrollChat();await new Promise(function(resolve){setTimeout(resolve,6);});}}
    if(S.stopRequested){var partial=shown.trim();assistantNode.body.textContent=partial?partial+'\n\n[Generation stopped]':'Generation stopped.';S.msgs.push({role:'assistant',content:assistantNode.body.textContent});}
    else{S.msgs.push({role:'assistant',content:text});}
    saved=true;
  }catch(error){
    if((error&&error.name==='AbortError')||S.stopRequested){assistantNode.body.textContent='Generation stopped.';S.msgs.push({role:'assistant',content:'Generation stopped.'});saved=true;}
    else{S.error=humanError(error);assistantNode.body.textContent=S.error;if(error.status===401)showLogin('Your session expired.');}
  }
  finally{S.busy=false;S.controller=null;S.stopRequested=false;if(button){button.disabled=false;button.textContent='➜';button.classList.remove('stop');button.onclick=send;button.title='Send';}if(saved)saveActive();else saveActive();scrollChat();}
}

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
  return '<div class="section-head"><div><p class="eyebrow">Settings</p><h2>Settings</h2><p class="lead">Profiles, separate user accounts, personalisation and system details.</p></div><button class="back" onclick="Velora.go(\'home\')">Back</button></div><div class="settings-grid">'+profileCard()+personalisationCard()+machineCard()+licensingCard()+accountsCard()+'</div>';
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
  app.innerHTML='<div class="shell"><main class="main login-main"><div class="panel login-card"><div class="brand login-brand"><div class="logo">V</div><div><h1>VeloraOS</h1><p>Sign in to your local AI appliance</p></div></div>'+(message?'<div class="login-error">'+escapeHtml(message)+'</div>':'')+'<div class="field"><label>Username</label><input id="login-username" value="admin" autocomplete="username"></div><div class="field"><label>Password</label><input id="login-password" type="password" placeholder="Password" autocomplete="current-password" onkeydown="if(event.key===\'Enter\')Velora.doLogin()"></div><button class="btn login-button" id="login-button" onclick="Velora.doLogin()">Login</button><p class="muted small">Existing admin starts as <b>admin</b> / <b>veloraos</b>. Change it under Settings → My profile.</p><p class="small" id="login-status"></p></div></main></div>';
}
async function doLogin(){
  var username=($('#login-username')||{}).value||'';var password=($('#login-password')||{}).value||'';var button=$('#login-button');if(button)button.disabled=true;setStatus('login-status','Signing in...',false);
  try{var result=await API.post('/api/auth/login',{username:username,password:password});localStorage.removeItem('velora_session');await startAuthenticated(result.user,result.csrfToken);}
  catch(error){setStatus('login-status',humanError(error),true);if(button)button.disabled=false;}
}
async function logout(){
  try{await API.post('/api/auth/logout',{});}catch(_){ }
  stopUpdatePolling();S.user=null;S.csrf='';S.license=null;S.update=null;S.settings={};S.chats=[];S.msgs=[];S.active=null;showLogin('You have been signed out.');
}
async function startAuthenticated(user,csrfToken){
  S.user=user;S.csrf=csrfToken||S.csrf||'';S.pendingAvatar=null;
  try{await loadSettings();await loadCore();await loadLicense();if(user&&user.role==='admin')await loadUpdateStatus();}
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
  go:go,installModel:installModel,deleteModel:deleteModel,newChat:newChat,openChat:openChat,deleteChat:deleteChat,setSearch:setSearch,toggleModelMenu:toggleModelMenu,selectModel:selectModel,send:send,stopGeneration:stopGeneration,toggleCosmicReasoning:toggleCosmicReasoning,previewCosmicReasoning:previewCosmicReasoning,commitCosmicReasoning:commitCosmicReasoning,
  reload:reload,logout:logout,doLogin:doLogin,openImagePicker:openImagePicker,handleImageFiles:handleImageFiles,removePendingImage:removePendingImage,
  selectProfilePicture:selectProfilePicture,removeProfilePicture:removeProfilePicture,saveProfile:saveProfile,savePersonalisation:savePersonalisation,resetPersonalisation:resetPersonalisation,
  createAccount:createAccount,updateAccount:updateAccount,deleteAccount:deleteAccount,toggleLicenseKey:toggleLicenseKey,activateLicense:activateLicense,recheckLicense:recheckLicense,deactivateLicense:deactivateLicense,loadUpdateStatus:loadUpdateStatus,checkForUpdates:checkForUpdates,openUpdateModal:openUpdateModal,closeUpdateModal:closeUpdateModal,installUpdate:installUpdate,dismissUpdateNotice:dismissUpdateNotice,restartWebUi:restartWebUi,confirmReboot:confirmReboot,render:render
};

boot();
})();

window.VELORAOS_RELEASE="1.6.1";

