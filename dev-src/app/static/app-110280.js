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
window.addEventListener('click',function(event){
  if(!S||!S.topMenuOpen)return;
  var trigger=event.target&&event.target.closest?event.target.closest('.profile-menu-wrap'):null;
  if(trigger)return;
  S.topMenuOpen=false;
  render();
});
window.addEventListener('keydown',function(event){
  if(S&&S.mobileChatsOpen&&event.key==='Escape'){event.preventDefault();toggleMobileChats(false);return;}
  if(S&&S.mobileChatsOpen&&event.key==='Tab'&&trapKeyboardFocus('#chat-history-drawer',event))return;
  if(S&&S.menu&&event.key==='Escape'){event.preventDefault();S.menu=false;render();focusAfterRender('#model-picker-button');return;}
  if(S&&S.menu&&moveMenuFocus('#model-picker-menu .model-option',event))return;
  if(S&&S.topMenuOpen&&event.key==='Escape'){event.preventDefault();S.topMenuOpen=false;render();focusAfterRender('#profile-menu-button');return;}
  if(S&&S.topMenuOpen&&moveMenuFocus('#profile-menu button',event))return;
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
  del:function(url){return this.request('DELETE',url);},
  upload:async function(url,file){
    var form=new FormData();form.append('file',file);
    var response=await fetch(url,{method:'POST',cache:'no-store',credentials:'same-origin',headers:{'X-CSRF-Token':(S&&S.csrf)||''},body:form});
    var text=await response.text();var data;try{data=text?JSON.parse(text):{};}catch(_){data={detail:text};}
    if(!response.ok)throw new ApiError(humanError(data)||('HTTP '+response.status),response.status,data);
    return data;
  }
};

var icons={
  chat:'<svg viewBox="0 0 24 24"><path d="M7.2 18.2 3.5 21V6.6A3.1 3.1 0 0 1 6.6 3.5h10.8a3.1 3.1 0 0 1 3.1 3.1v7.8a3.1 3.1 0 0 1-3.1 3.1H8.1c-.32 0-.63.1-.9.3Z"/><path d="M8 9h8"/><path d="M8 13h5.8"/></svg>',
  models:'<svg viewBox="0 0 24 24"><ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6"/><path d="M4.5 12v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6"/></svg>',
  image:'<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="3.2"/><circle cx="9" cy="10" r="1.7"/><path d="m6.5 17 5.1-5.1a2 2 0 0 1 2.8 0L20 17"/></svg>',
  video:'<svg viewBox="0 0 24 24"><rect x="3.5" y="6" width="12.5" height="12" rx="3.2"/><path d="m16 10.2 4.7-2.5v8.6L16 13.8Z"/></svg>',
  settings:'<svg viewBox="0 0 24 24"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.09a2 2 0 0 1 1 1.74v.5a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z"/><circle cx="12" cy="12" r="3"/></svg>',
  fallback:'<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>'
};

var S={
  page:'home',system:null,models:[],selected:'veloraos-auto',menu:false,msgs:[],chats:[],active:null,
  busy:false,error:'',search:'',pendingImages:[],user:null,settings:{},accounts:[],pendingAvatar:null,controller:null,stopRequested:false,reasoning:2,reasoningOpen:false,csrf:'',license:null,licenseBusy:false,showLicenseKey:false,update:null,updateBusy:false,updateModal:false,updatePoll:null,updateAnnounced:'',setup:null,setupStep:1,setupBusy:false,setupDownload:null,setupDeviceDraft:null,setupModelSelection:null,setupComplete:false,modelTasks:{},chatTasks:{},backgroundPoll:null,backgroundSeen:{},mobileSecurity:null,chatScrollIntent:'',lockdownMode:false,
  diagnostics:null,diagnosticsBusy:false,diagnosticsTest:null,editingIndex:null,editingDraft:'',chatNotice:'',
  backups:[],recovery:null,recoveryBusy:false,recoveryNotice:'',diagnosticsArchive:null,topMenuOpen:false,mobileChatsOpen:false,a11yMessage:'',
  workspaces:[],workspace:null,workspaceFile:null,workspaceNotice:'',knowledge:[],knowledgeResults:[],imageStudio:null,imageBusy:false,imageError:'',imageDraft:{prompt:'',negativePrompt:'',checkpoint:'',size:'768x768',steps:28,cfg:7,sampler:'euler',scheduler:'normal',seed:''}
};

function accessibilityChrome(){return '<div id="a11y-status" class="sr-only" role="status" aria-live="polite" aria-atomic="true">'+escapeHtml(S.a11yMessage||'')+'</div>';}
function announce(message){S.a11yMessage=String(message||'');var region=$('#a11y-status');if(region)region.textContent=S.a11yMessage;}
function focusAfterRender(selector){window.requestAnimationFrame(function(){var target=$(selector);if(target)target.focus();});}
function trapKeyboardFocus(selector,event){var container=$(selector);if(!container)return false;var items=container.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])');if(!items.length)return false;var first=items[0],last=items[items.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();return true;}if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();return true;}return false;}
function moveMenuFocus(selector,event){if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return false;var items=Array.prototype.slice.call(document.querySelectorAll(selector));if(!items.length)return false;event.preventDefault();var index=items.indexOf(document.activeElement);if(event.key==='Home')index=0;else if(event.key==='End')index=items.length-1;else if(event.key==='ArrowDown')index=(index+1+items.length)%items.length;else index=(index-1+items.length)%items.length;items[index].focus();return true;}

var deferredPwaPrompt=null;
function isStandalonePwa(){return !!((window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches)||window.navigator.standalone===true);}
function isIosDevice(){return /iphone|ipad|ipod/i.test(navigator.userAgent||'');}
function pwaSecureContext(){return window.isSecureContext||location.hostname==='localhost'||location.hostname==='127.0.0.1';}
function pwaInstallState(){
  if(isStandalonePwa())return {state:'installed',title:'Installed',message:'VeloraOS is running as an installed Home Screen app.'};
  if(!pwaSecureContext())return {state:'https-required',title:'Trust HTTPS first',message:'Open VeloraOS over HTTPS and trust the VeloraOS Local CA on this device before installing the PWA.'};
  if(deferredPwaPrompt)return {state:'installable',title:'Ready to install',message:'Install VeloraOS for a standalone Home Screen app experience.'};
  if(isIosDevice())return {state:'ios',title:'Add to Home Screen',message:'On iPhone or iPad, use Safari Share and choose Add to Home Screen.'};
  return {state:'browser',title:'Browser installation',message:'Use your browser install or Add to Home Screen menu when available.'};
}
async function installPwa(){
  if(isStandalonePwa()){announce('VeloraOS is already installed.');return;}
  if(!pwaSecureContext()){announce('A trusted HTTPS connection is required to install VeloraOS as a PWA.');return;}
  if(deferredPwaPrompt){
    deferredPwaPrompt.prompt();
    var result=await deferredPwaPrompt.userChoice;
    deferredPwaPrompt=null;
    announce(result&&result.outcome==='accepted'?'VeloraOS installation accepted.':'VeloraOS installation dismissed.');
    render();
    return;
  }
  announce(isIosDevice()?'In Safari, tap Share then Add to Home Screen.':'Use your browser menu to install VeloraOS or add it to the Home Screen.');
}
function registerPwa(){
  if('serviceWorker' in navigator&&pwaSecureContext()){
    navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(function(error){console.warn('VeloraOS PWA registration failed',error);});
  }
  window.addEventListener('beforeinstallprompt',function(event){
    event.preventDefault();
    deferredPwaPrompt=event;
    render();
  });
  window.addEventListener('appinstalled',function(){
    deferredPwaPrompt=null;
    pushNotification({id:'pwa-installed-'+Date.now(),type:'system',title:'VeloraOS installed',message:'VeloraOS was added to this device.',priority:'success'});
    render();
  });
}
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
  S.lockdownMode=!!S.settings.lockdown_mode;
  applyPersonalisation();
}

async function loadLicense(){
  try{S.license=await API.get('/api/license/status');}
  catch(error){if(error.status===401)throw error;S.license={configured:false,activated:false,status:'error',connectionState:'error',message:humanError(error)};}
}

async function loadSetupStatus(){
  if(!S.user||S.user.role!=='admin'){S.setup=null;return null;}
  try{S.setup=await API.get('/api/setup/status');if(S.setupModelSelection===null)S.setupModelSelection=(S.setup.selectedModelIds||[]).slice();return S.setup;}
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
function notificationReadKey(id){return 'velora_notification_read_'+String(id||'');}
function notificationIsRead(id){return localStorage.getItem(notificationReadKey(id))==='1';}
function notificationHistory(){try{var value=JSON.parse(localStorage.getItem('velora_notification_history')||'[]');return Array.isArray(value)?value:[];}catch(_){return [];}}
function saveNotificationHistory(items){try{localStorage.setItem('velora_notification_history',JSON.stringify((items||[]).slice(0,50)));}catch(_){}}
function pushNotification(item){
  if(!item||!item.id)return;var items=notificationHistory();if(items.some(function(existing){return existing.id===item.id;}))return;
  item.time=item.time||new Date().toISOString();items.unshift(item);saveNotificationHistory(items);localStorage.removeItem(notificationReadKey(item.id));
}
function notificationItems(){
  var items=notificationHistory();
  if(S.user&&S.user.role==='admin'&&S.update){
    if(S.update.updateAvailable){var version=String(S.update.latestVersion||'update');pushNotification({id:'update-'+version,type:'update',title:S.update.title||('VeloraOS '+version+' available'),message:(S.update.releaseNotes&&S.update.releaseNotes[0])||'A newer VeloraOS release is ready to review.',action:'updates',actionLabel:'View update',time:S.update.publishedAt||S.update.lastCheckedAt||'',priority:'important'});}
    else if(S.update.state==='failed'){pushNotification({id:'update-failed-'+String(S.update.lastCheckedAt||Date.now()),type:'warning',title:'Update check needs attention',message:S.update.error||S.update.message||'VeloraOS could not complete the latest update check.',action:'updates',actionLabel:'Open updates',time:S.update.lastCheckedAt||'',priority:'warning'});}
  }
  return notificationHistory();
}
function unreadNotificationCount(){return notificationItems().filter(function(item){return !notificationIsRead(item.id);}).length;}
function markNotificationRead(id){if(id)localStorage.setItem(notificationReadKey(id),'1');}
function markAllNotificationsRead(){notificationItems().forEach(function(item){markNotificationRead(item.id);});render();announce('All notifications marked as read.');}
function clearNotifications(){saveNotificationHistory([]);render();announce('Notification history cleared.');}
function openNotificationAction(id,page){markNotificationRead(id);go(page);}
function updateRecentlyStarted(){
  return !!(S.updateInstallStartedAt&&(Date.now()-S.updateInstallStartedAt)<180000);
}
function updateTransportMessage(){
  return 'VeloraOS is restarting its Web UI while the update is applied. This temporary connection loss is expected — keep this page open and it will reconnect automatically.';
}
function updateTransportFailure(error){
  var status=Number(error&&error.status||0);
  var message=String(humanError(error)||'');
  return status===0||status===502||status===503||status===504||/<html|bad gateway|service unavailable|gateway timeout/i.test(message);
}
function markUpdateReconnecting(){
  S.updateReconnect=true;
  var previous=Object.assign({},S.update||{});
  S.update=Object.assign(previous,{
    state:(previous.state==='downloading'?'downloading':'installing'),
    message:updateTransportMessage(),
    error:null,
    updateAvailable:false,
    transportReconnecting:true
  });
  return S.update;
}

async function loadUpdateStatus(){
  if(!S.user||S.user.role!=='admin'){S.update=null;return null;}
  try{
    var recovered=S.updateReconnect;
    var payload=await API.get('/api/update/status');
    S.updateReconnect=false;
    S.update=payload;
    if(recovered&&S.update){
      S.update.transportReconnecting=false;
      if(S.update.state==='complete')announceUpdate('VeloraOS update completed and the Web UI reconnected.');
      else if(S.update.state==='failed')announceUpdate('VeloraOS reconnected after the update attempt. Review the recorded update log.');
      else announceUpdate('VeloraOS Web UI reconnected.');
    }
    if(S.update&&S.update.updateAvailable&&S.updateAnnounced!==S.update.latestVersion){S.updateAnnounced=S.update.latestVersion;announceUpdate('VeloraOS '+S.update.latestVersion+' is available.');}
    return S.update;
  }catch(error){
    if(error.status===401)throw error;
    if(updateTransportFailure(error)&&(updateIsRunning()||S.updateReconnect||updateRecentlyStarted())){
      return markUpdateReconnecting();
    }
    var safe=humanError(error);
    if(/<html|<!doctype|bad gateway/i.test(String(safe||'')))safe='The update status service could not be reached.';
    S.updateReconnect=false;
    S.update={state:'failed',error:safe,message:safe,updateAvailable:false,releaseNotes:[]};
    return S.update;
  }
}
function startUpdatePolling(){
  if(S.updatePoll)clearInterval(S.updatePoll);
  if(!S.user||S.user.role!=='admin')return;
  S.updatePoll=setInterval(async function(){
    var previous=S.update&&S.update.state;
    var wasReconnect=S.updateReconnect;
    await loadUpdateStatus();
    if(S.page==='updates'||S.updateReconnect||wasReconnect||(S.update&&S.update.updateAvailable&&!updateIsDismissed())||previous!==(S.update&&S.update.state))render();
  },(updateIsRunning()||S.updateReconnect||updateRecentlyStarted())?2000:30000);
}
function stopUpdatePolling(){if(S.updatePoll){clearInterval(S.updatePoll);S.updatePoll=null;}}


async function refreshChatsFromServer(){
  var payload=await API.get('/api/chats');
  S.chats=payload.chats||payload||[];
  var current=S.chats.find(function(chat){return chat.id===S.active;});
  if(current){S.msgs=current.messages||[];S.selected=current.model||S.selected;}
}
async function refreshModelsFromServer(){
  var payload=await API.get('/api/models');
  S.models=payload.models||payload||[];
}
function taskIsActive(task){return ['queued','downloading','running'].indexOf(String((task&&task.status)||'').toLowerCase())>=0;}
function taskIsComplete(task){return ['complete','completed','done','success'].indexOf(String((task&&task.status)||'').toLowerCase())>=0;}
function syncActiveChatBusy(){
  var task=S.active&&S.chatTasks[S.active];
  S.busy=!!(task&&taskIsActive(task));
  if(!S.busy&&S.active&&task&&!taskIsActive(task))delete S.chatTasks[S.active];
}
async function loadBackgroundTasks(){
  if(!S.user)return;
  try{
    var payload=await API.get('/api/tasks');
    var tasks=payload.tasks||[];
    var nextModels={};
    var nextChats={};
    var refreshChats=false;
    var refreshModels=false;

    tasks.forEach(function(task){
      var id=String(task.id||task.task_id||'');
      var kind=String(task.kind||'');
      var state=String(task.status||'').toLowerCase();

      if(kind==='model'&&task.model_id){
        if(!nextModels[task.model_id]&&(taskIsActive(task)||['error','failed','cancelled'].indexOf(state)>=0))nextModels[task.model_id]=task;
        if(!S.backgroundSeen[id]&&taskIsComplete(task)){
          S.backgroundSeen[id]=true;
          refreshModels=true;
          pushNotification({id:'background-model-complete-'+id,type:'model',title:(task.model||'Model')+' installed',message:'The model download finished in the background and is ready to use.',action:'models',actionLabel:'Open Models',priority:'success'});
        }else if(!S.backgroundSeen[id]&&['error','failed'].indexOf(state)>=0){
          S.backgroundSeen[id]=true;
          pushNotification({id:'background-model-failed-'+id,type:'warning',title:(task.model||'Model')+' download failed',message:task.error||task.output||'The model download failed.',action:'models',actionLabel:'Open Models',priority:'warning'});
        }else if(!S.backgroundSeen[id]&&state==='cancelled'){
          S.backgroundSeen[id]=true;
          pushNotification({id:'background-model-cancelled-'+id,type:'activity',title:(task.model||'Model')+' download cancelled',message:'You can restart it from Models.',action:'models',actionLabel:'Open Models',priority:'activity'});
        }
      }

      if(kind==='chat'&&task.chat_id){
        // Busy state must come only from an actually active task. Historical
        // completed jobs remain useful for notifications, but must never lock
        // the composer or block a second turn.
        if(taskIsActive(task)&&!nextChats[task.chat_id])nextChats[task.chat_id]=task;
        if(!S.backgroundSeen[id]&&taskIsComplete(task)){
          S.backgroundSeen[id]=true;
          refreshChats=true;
          pushNotification({id:'background-chat-complete-'+id,type:'success',title:'Chat response ready',message:(task.selected_profile_name?task.selected_profile_name+' finished ':'VeloraOS finished ')+'generating your response in the background.',action:'chat',actionLabel:'Open Chat',priority:'success'});
        }else if(!S.backgroundSeen[id]&&['error','failed'].indexOf(state)>=0){
          S.backgroundSeen[id]=true;
          pushNotification({id:'background-chat-failed-'+id,type:'warning',title:'Chat generation failed',message:task.error||task.output||'VeloraOS could not finish the response.',action:'chat',actionLabel:'Open Chat',priority:'warning'});
        }
      }
    });

    var previousBusy=!!S.busy;
    var previousModelSnapshot=JSON.stringify(S.modelTasks||{});
    var previousChatSnapshot=JSON.stringify(S.chatTasks||{});

    S.modelTasks=nextModels;
    S.chatTasks=nextChats;
    syncActiveChatBusy();
    if(S.page==='chat'&&S.busy)updateThinkingStatus();

    if(refreshModels)await refreshModelsFromServer();
    if(refreshChats)await refreshChatsFromServer();

    var modelChanged=previousModelSnapshot!==JSON.stringify(S.modelTasks||{});
    var chatChanged=previousChatSnapshot!==JSON.stringify(S.chatTasks||{});
    var busyChanged=previousBusy!==!!S.busy;

    // Do not rebuild the Chat DOM for routine background polling.
    // Re-render Chat only for completion/failure/reconnect state changes that affect visible content.
    if(S.page==='models'&&modelChanged)render();
    if(S.page==='chat'&&(refreshChats||busyChanged||(chatChanged&&!S.busy)))render();
    else if(refreshChats||refreshModels)render();
  }catch(error){
    if(error.status===401)return;
  }
}
function startBackgroundPolling(immediate){
  if(S.backgroundPoll)clearInterval(S.backgroundPoll);
  if(immediate!==false)loadBackgroundTasks();
  S.backgroundPoll=setInterval(loadBackgroundTasks,2500);
}
function stopBackgroundPolling(){
  if(S.backgroundPoll){clearInterval(S.backgroundPoll);S.backgroundPoll=null;}
}
async function loadMobileSecurity(){
  try{S.mobileSecurity=await API.get('/api/security/mobile');}
  catch(error){if(error.status===401)throw error;S.mobileSecurity={httpsActive:false,certificateReady:false,caReady:false,error:humanError(error)};}
  return S.mobileSecurity;
}

async function loadCore(){
  try{S.system=await API.get('/api/system');}catch(error){if(error.status===401)throw error;S.system={error:humanError(error)};}
  try{var models=await API.get('/api/models');S.models=models.models||models||[];}catch(error){if(error.status===401)throw error;S.models=[];}
  try{
    var chats=await API.get('/api/chats');
    S.chats=chats.chats||chats||[];
    S.chats.forEach(function(chat){if(chat&&chat.model)chat.model=normaliseChatModelSelection(chat.model);});
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
  try{await loadMobileSecurity();}catch(_){}
}

function status(){return (S.system&&S.system.acceleration)||(S.system&&S.system.gpu&&S.system.gpu.acceleration)||'Trusted LAN';}
function statusMeta(){
  var value=String(status()||'Trusted LAN');
  var match=value.match(/^(.+?)\s*\((.+)\)$/);
  var main=match?match[1]:value;
  var sub=match?match[2]:'';
  if(!sub){
    if(/GPU ready/i.test(main))sub='Acceleration available';
    else if(/CPU only/i.test(main))sub='Open Diagnostics';
    else sub='Secure local access';
  }
  return {main:main,sub:sub};
}
function mobileBottomNav(){
  function item(page,label,svg){
    var active=S.page===page;
    return '<button class="mobile-nav-item'+(active?' active':'')+'" '+(active?'aria-current="page" ':'')+'data-page="'+page+'" onclick="Velora.go(this.dataset.page)"><span class="mobile-nav-icon" aria-hidden="true">'+svg+'</span><span>'+label+'</span></button>';
  }
  var home='<svg viewBox="0 0 24 24"><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg>';
  var chat='<svg viewBox="0 0 24 24"><path d="M5 18 3 21v-5a8 8 0 1 1 4 4"/><path d="M8 10h8"/><path d="M8 14h5"/></svg>';
  var models='<svg viewBox="0 0 24 24"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/></svg>';
  var settings='<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a7 7 0 0 0-1.7-1L14.5 3h-5L9 6.1a7 7 0 0 0-1.7 1l-2.4-1-2 3.4L5 11a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.4 3.1h5l.4-3.1a7 7 0 0 0 1.7-1l2.4 1 2-3.4-2-1.5a7 7 0 0 0 .1-1Z"/></svg>';
  return '<nav class="mobile-bottom-nav" aria-label="Mobile navigation">'+item('home','Home',home)+item('chat','Chat',chat)+item('models','Models',models)+item('settings','Settings',settings)+'</nav>';
}
function top(){
  var maximum=S.page==='chat'&&clampReasoning(S.reasoning)===5;
  var notificationCount=unreadNotificationCount();
  var notificationBadge=notificationCount?'<span class="notification-badge" aria-label="'+notificationCount+' unread notifications">'+notificationCount+'</span>':'';
  var updateBadge=S.user&&S.user.role==='admin'&&S.update&&S.update.updateAvailable?'<span class="nav-badge" aria-label="Update available">1</span>':'';
  function navButton(page,label,extra){var current=S.page===page;return '<button class="'+(current?'active':'')+'" '+(current?'aria-current="page" ':'')+'onclick="Velora.go(\''+page+'\')">'+label+(extra||'')+'</button>';}
  var meta=statusMeta();
  var statusClass=/CPU only/i.test(meta.main)?' status-chip-warn':'';
  var adminItems=S.user&&S.user.role==='admin'?'<button role="menuitem" onclick="Velora.go(\'updates\')">System updates'+updateBadge+'</button><button role="menuitem" onclick="Velora.go(\'system-info\')">System Info</button>':'';
  return '<header class="top'+(maximum?' cosmic-maximum':'')+'"><div class="top-inner"><div class="brand"><div class="logo" role="img" aria-label="VeloraOS">V</div><div><h1>VeloraOS</h1><p>'+escapeHtml((S.user&&S.user.display_name)||'User')+'\'s local AI appliance</p></div></div><div class="top-center"><div id="cosmic-header-badge" class="cosmic-header-badge" role="status" '+(maximum?'':'hidden')+'><span aria-hidden="true">&#10022;</span> Maximum Power</div><nav class="nav nav-dock" aria-label="Primary navigation">'+navButton('home','Home')+navButton('chat','Chat')+navButton('models','Models')+navButton('workspaces','Workspaces')+'</nav></div><div class="top-right"><button class="notification-button'+(notificationCount?' has-unread':'')+'" data-page="notifications" onclick="Velora.go(this.dataset.page)" aria-label="Notifications'+(notificationCount?': '+notificationCount+' unread':'')+'" title="Notifications"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>'+notificationBadge+'</button><button class="status-chip'+statusClass+'" onclick="Velora.go(\'diagnostics\')" aria-label="System status: '+escapeHtml(meta.main)+'. '+escapeHtml(meta.sub)+'" title="'+escapeHtml(status())+'"><span class="dot" aria-hidden="true"></span><span class="status-chip-copy"><b>'+escapeHtml(meta.main)+'</b><small>'+escapeHtml(meta.sub)+'</small></span></button><div class="profile-menu-wrap"><button id="profile-menu-button" class="top-profile top-profile-trigger" onclick="Velora.toggleTopMenu(event)" aria-label="Open profile menu for '+escapeHtml((S.user&&S.user.display_name)||'Profile')+'" aria-expanded="'+(S.topMenuOpen?'true':'false')+'" aria-controls="profile-menu" aria-haspopup="menu">'+avatarHtml(S.user,'top-avatar')+'<span>'+escapeHtml((S.user&&S.user.display_name)||'Profile')+'</span><span class="top-profile-chevron" aria-hidden="true">&#9662;</span></button><div id="profile-menu" class="profile-menu'+(S.topMenuOpen?' open':'')+'" role="menu" aria-labelledby="profile-menu-button"><button role="menuitem" onclick="Velora.go(\'settings\')">Settings</button>'+adminItems+'<button role="menuitem" onclick="Velora.logout()">Logout</button></div></div></div></div></header>';
}
function shell(content){return '<div class="shell">'+accessibilityChrome()+top()+'<main id="main-content" class="main" tabindex="-1">'+content+'</main>'+mobileBottomNav()+'</div>';}
async function go(page){if(page==='workspaces'){await loadWorkspaces();await loadKnowledge();}
  S.topMenuOpen=false;S.mobileChatsOpen=false;
  if(S.setup&&S.setup.required&&page!=='setup')return;
  if(['image','video','upgrades'].indexOf(page)>=0){S.page='coming-soon';S.comingSoonTitle={image:'Image Studio',video:'Video Studio',upgrades:'Upgrades'}[page];render();focusAfterRender('#main-content');return;}
  S.page=page;S.error='';
  if(page==='settings'){await loadLicense();await loadMobileSecurity();if(S.user&&S.user.role==='admin')await loadAccounts();}
  if(page==='diagnostics')await loadDiagnostics();
  if(page==='system-info'&&S.user&&S.user.role==='admin'){await loadDiagnostics();await loadRecovery();await loadMobileSecurity();}
  if(page==='image')await loadImageStudio();
  if(page==='recovery'&&S.user&&S.user.role==='admin')await loadRecovery();
  if(page==='updates'&&S.user&&S.user.role==='admin')await loadUpdateStatus();
  if(page==='notifications'&&S.user&&S.user.role==='admin')await loadUpdateStatus();
  render();focusAfterRender('#main-content');
}
function render(){
  var app=$('#app');if(!app)return;
  var previousChatViewport=S.page==='chat'?captureChatViewport():null;
  if(!S.user){showLogin();return;}
  if(S.page==='setup'&&S.user&&S.user.role==='admin'){app.innerHTML=setupPage();afterSetupRender();return;}
  if(S.page==='chat'){app.innerHTML=chatPage();afterChat(previousChatViewport);return;}
  if(S.page==='workspaces'){app.innerHTML=workspacePage();return;}
  if(S.page==='coming-soon'){app.innerHTML=shell(comingSoonPage(S.comingSoonTitle));return;}
  if(S.page==='models'){app.innerHTML=shell(modelsPage());return;}
  if(S.page==='diagnostics'){app.innerHTML=shell(diagnosticsPage());return;}
  if(S.page==='system-info'&&S.user&&S.user.role==='admin'){app.innerHTML=shell(systemInfoPage());return;}
  if(S.page==='recovery'&&S.user&&S.user.role==='admin'){app.innerHTML=shell(recoveryPage());return;}
  if(S.page==='image'){app.innerHTML=shell(imageStudioPage());return;}
  if(S.page==='video'){app.innerHTML=shell(studioPage('Video Studio','Create short local AI videos on supported hardware.','Video generation engine is staged for the managed workflow bundle.'));return;}
  if(S.page==='settings'){app.innerHTML=shell(settingsPage());return;}
  if(S.page==='notifications'){app.innerHTML=shell(notificationsPage());return;}
  if(S.page==='updates'&&S.user&&S.user.role==='admin'){app.innerHTML=shell(updatesPage()+updateModalHtml());afterUpdateRender();return;}
  if(S.page==='upgrades'){app.innerHTML=shell(upgradesPage());return;}
  app.innerHTML=shell(homePage());
}
function updateNotificationHtml(){
  if(!S.user||S.user.role!=='admin'||!S.update||!S.update.updateAvailable||updateIsDismissed())return '';
  return '<section class="update-notice" role="status"><div><span class="tag">Update available</span><h3>'+escapeHtml(S.update.title||('VeloraOS '+S.update.latestVersion))+'</h3><p>'+escapeHtml((S.update.releaseNotes&&S.update.releaseNotes[0])||'A newer VeloraOS release is ready to review.')+'</p></div><div class="update-notice-actions"><button class="btn" onclick="Velora.go(\'updates\')">View update</button><button class="icon-button" onclick="Velora.dismissUpdateNotice()" aria-label="Dismiss update notification" title="Dismiss">×</button></div></section>';
}
function notificationIcon(type){
  if(type==='warning')return '<svg viewBox="0 0 24 24"><path d="M12 3 2.7 20h18.6L12 3Z"/><path d="M12 9v5"/><path d="M12 17.5h.01"/></svg>';
  if(type==='success'||type==='model')return '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></svg>';
  if(type==='activity')return '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v5l3 2"/></svg>';
  return '<svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 0 1 12 0v5l2 3H4l2-3V8Z"/><path d="M10 20h4"/></svg>';
}
function notificationsPage(){
  var items=notificationItems();
  var cards=items.map(function(item){
    var action=item.action?'<button class="btn ghost compact" data-notification-id="'+escapeHtml(item.id)+'" data-notification-page="'+escapeHtml(item.action)+'" onclick="Velora.openNotificationAction(this.dataset.notificationId,this.dataset.notificationPage)">'+escapeHtml(item.actionLabel||'Open')+'</button>':'';
    return '<article class="notification-card '+escapeHtml(item.priority||'')+'"><div class="notification-icon" aria-hidden="true">'+notificationIcon(item.type)+'</div><div class="notification-copy"><div class="notification-meta"><span class="tag">'+escapeHtml(item.type==='update'?'System update':item.type==='warning'?'Attention':item.type==='model'?'Models':item.type==='success'?'System':'Activity')+'</span>'+(item.time?'<time>'+escapeHtml(formatUpdateDate(item.time))+'</time>':'')+'</div><h3>'+escapeHtml(item.title)+'</h3><p>'+escapeHtml(item.message)+'</p>'+action+'</div></article>';
  }).join('');
  if(!cards)cards='<div class="panel notification-empty"><div class="notification-empty-icon">'+notificationIcon('update')+'</div><h3>You\'re all caught up</h3><p class="muted">New system updates and important VeloraOS alerts will appear here.</p></div>';
  return '<div class="section-head"><div><p class="eyebrow">VeloraOS alerts</p><h2>Notifications</h2><p class="lead">System updates and important operating-system messages in one place.</p></div><div class="section-actions"><button class="btn ghost" onclick="Velora.markAllNotificationsRead()" '+(items.length?'':'disabled')+'>Mark all read</button><button class="btn ghost" onclick="Velora.clearNotifications()" '+(items.length?'':'disabled')+'>Clear history</button><button class="back" data-page="home" onclick="Velora.go(this.dataset.page)">Back</button></div></div><div class="notification-list">'+cards+'</div>';
}
function homePage(){
  return updateNotificationHtml()+'<section class="hero"><p class="eyebrow">VeloraOS Public Beta</p><h2>Private AI, ready locally.</h2><p class="lead">Chat and model management are available during the public beta. More private AI workspaces will unlock in future releases.</p></section><section class="apps beta-apps">'+appCard('chat','Chat','Talk to your installed local models with private saved conversations.',false)+appCard('models','Models','Install and manage the local models available to Chat.',false)+appCard('image','Image Studio','Private local image generation and galleries.',true)+appCard('video','Video Studio','Private local video generation on supported hardware.',true)+'</section><div id="update-live" class="sr-only" aria-live="polite"></div>';
}
function appCard(page,title,description,comingSoon){var icon=icons[page]||icons.fallback;return '<button class="app-card'+(comingSoon?' coming-soon':'')+'" '+(comingSoon?'disabled aria-disabled="true"':'onclick="Velora.go(\''+page+'\')"')+'><div class="app-icon">'+icon+'</div>'+(comingSoon?'<span class="beta-coming-soon">Coming soon</span>':'<span class="beta-live">Available now</span>')+'<h3>'+escapeHtml(title)+'</h3><p>'+escapeHtml(description)+'</p></button>';}
function comingSoonPage(title){return '<section class="coming-soon-page"><span class="tag">Public beta</span><h2>'+escapeHtml(title||'This workspace')+' is coming soon.</h2><p class="lead">Chat is the available VeloraOS workspace during public beta. We are finishing this experience before opening it to everyone.</p><button class="btn" onclick="Velora.go(\'chat\')">Open Chat</button><button class="btn ghost" onclick="Velora.go(\'home\')">Back home</button></section>';}

function allModels(includeUninstalled){
  var base=[
    {id:'veloraos-tiny',name:'VeloraOS Tiny',tag:'qwen3:4b',kind:'VeloraOS Basic',category:'chat',download:'2.6 GB',desc:'Qwen3 4B tuned for concise answers and basic operations.'},
    {id:'veloraos-quick',name:'VeloraOS Quick',tag:'qwen3:4b',kind:'VeloraOS Everyday',category:'chat',download:'2.6 GB',desc:'Qwen3 4B with stronger Cosmic Reasoning for everyday assistance.'},
    {id:'veloraos-deep',name:'VeloraOS Deep Thoughts',tag:'qwen3:8b',kind:'VeloraOS Reasoning',category:'chat',download:'5.2 GB',desc:'Qwen3 8B with maximum Cosmic Reasoning for deep analysis and harder tasks.'},
    {id:'moondream',name:'Moondream Vision',tag:'moondream',kind:'Vision',category:'vision',download:'1.7 GB'},
    {id:'llava-7b',name:'LLaVA 7B',tag:'llava:7b',kind:'Vision',category:'vision',download:'4.7 GB'}
  ];
  var byId={};base.forEach(function(model){byId[model.id]=model;});
  (S.models||[]).forEach(function(model){
    var id=model.id||model.tag;if(!id)return;
    if(['smollm2-135m','smollm2-360m','qwen2.5-0.5b','tinyllama-1.1b','qwen3-4b','qwen3-8b'].indexOf(id)>=0)return;
    var normal={id:id,name:model.name||id,tag:model.tag||model.ollama||id,kind:model.kind||model.category||'chat',category:model.category||'chat',download:model.download||model.size||'Unknown',desc:model.desc||'',availability:model.availability||{}};
    if(byId[id])Object.assign(byId[id],normal);else{base.push(normal);byId[id]=normal;}
  });
  return includeUninstalled?base:base.filter(function(model){return !!(model.availability&&model.availability.installed);});
}
function chatModelOptions(){
  var installed=allModels(false).filter(function(model){return ['veloraos-tiny','veloraos-quick','veloraos-deep'].indexOf(model.id)>=0;});
  var codingInstalled=allModels(false).filter(function(model){return model.category==='coding';});
  var auto={id:'veloraos-auto',name:'VeloraOS Automatic',tag:'automatic',kind:'Intelligent selection',category:'chat',availability:{installed:installed.length>0}};
  var coding={id:'veloraos-coding',name:'VeloraOS Coding',tag:'hardware-selected',kind:(codingInstalled.length?'Best installed coder for this hardware':'Hardware-aware coding'),category:'chat',availability:{installed:installed.length>0||codingInstalled.length>0}};
  return [auto,coding].concat(installed);
}

async function loadWorkspaces(){
  try{var payload=await API.get('/api/workspaces');S.workspaces=payload.workspaces||[];}catch(error){S.workspaceNotice=humanError(error);}
}
async function createWorkspace(){
  var name=prompt('Workspace name');if(!name)return;
  try{var item=await API.post('/api/workspaces',{name:name,initialiseGit:confirm('Initialize this workspace as a Git repository?')});await loadWorkspaces();await openWorkspace(item.id);}
  catch(error){alert(humanError(error));}
}
async function openWorkspace(id){
  try{S.workspace=await API.get('/api/workspaces/'+encodeURIComponent(id));S.workspaceFile=null;S.page='workspaces';render();}
  catch(error){alert(humanError(error));}
}
async function openWorkspaceFile(path){
  if(!S.workspace||!S.workspace.workspace)return;
  try{S.workspaceFile=await API.get('/api/workspaces/'+encodeURIComponent(S.workspace.workspace.id)+'/file?path='+encodeURIComponent(path));render();}
  catch(error){alert(humanError(error));}
}
async function saveWorkspaceFile(){
  if(!S.workspaceFile||!S.workspace)return;
  var editor=$('#workspace-editor');var content=editor?editor.value:'';
  try{
    var preview=await API.post('/api/workspaces/'+encodeURIComponent(S.workspace.workspace.id)+'/file',{path:S.workspaceFile.path,content:content,expectedOldSha256:S.workspaceFile.sha256,apply:false});
    if(!preview.changed){alert('No changes.');return;}
    if(!confirm('Apply this reviewed change?\n\n'+String(preview.diff||'').slice(0,3000)))return;
    await API.post('/api/workspaces/'+encodeURIComponent(S.workspace.workspace.id)+'/file',{path:S.workspaceFile.path,content:content,expectedOldSha256:S.workspaceFile.sha256,apply:true});
    await openWorkspace(S.workspace.workspace.id);await openWorkspaceFile(S.workspaceFile.path);
  }catch(error){alert(humanError(error));}
}
async function newWorkspaceFile(){
  if(!S.workspace)return;var path=prompt('New file path, relative to workspace');if(!path)return;
  try{await API.post('/api/workspaces/'+encodeURIComponent(S.workspace.workspace.id)+'/file',{path:path,content:'',apply:true});await openWorkspace(S.workspace.workspace.id);await openWorkspaceFile(path);}
  catch(error){alert(humanError(error));}
}
async function runWorkspaceCommand(command){
  if(!S.workspace)return;
  try{var result=await API.post('/api/workspaces/'+encodeURIComponent(S.workspace.workspace.id)+'/command',{command:command,target:''});S.workspaceNotice=result.command+'\n\n'+result.output;render();}
  catch(error){alert(humanError(error));}
}
async function refreshWorkspaceGit(){
  if(!S.workspace)return;await openWorkspace(S.workspace.workspace.id);
}
async function workspaceGitDiff(){
  if(!S.workspace)return;
  try{var result=await API.get('/api/workspaces/'+encodeURIComponent(S.workspace.workspace.id)+'/git/diff');S.workspaceNotice=result.diff||'No unstaged diff.';render();}
  catch(error){alert(humanError(error));}
}
async function workspaceGitCommit(){
  if(!S.workspace)return;var git=S.workspace.git||{};
  if(!git.repository){try{await API.post('/api/workspaces/'+encodeURIComponent(S.workspace.workspace.id)+'/git/init',{});await refreshWorkspaceGit();}catch(error){alert(humanError(error));}return;}
  var paths=(git.changes||[]).map(function(item){return item.path;});if(!paths.length){alert('No changes to commit.');return;}
  var message=prompt('Commit message');if(!message)return;
  try{await API.post('/api/workspaces/'+encodeURIComponent(S.workspace.workspace.id)+'/git/stage',{paths:paths});var result=await API.post('/api/workspaces/'+encodeURIComponent(S.workspace.workspace.id)+'/git/commit',{message:message});alert('Committed '+result.commit);await refreshWorkspaceGit();}
  catch(error){alert(humanError(error));}
}
async function loadKnowledge(){
  try{var payload=await API.get('/api/knowledge');S.knowledge=payload.documents||[];}catch(error){S.workspaceNotice=humanError(error);}
}
async function uploadKnowledge(){
  var input=$('#knowledge-upload');if(!input||!input.files||!input.files[0])return;
  var form=new FormData();form.append('file',input.files[0]);
  try{
    var response=await fetch('/api/knowledge/upload',{method:'POST',credentials:'same-origin',headers:{'X-CSRF-Token':API.csrf||''},body:form});
    if(!response.ok)throw new Error(await response.text());
    await loadKnowledge();render();
  }catch(error){alert(humanError(error));}
}
async function searchKnowledge(){
  var input=$('#knowledge-query');var query=input&&input.value.trim();if(!query)return;
  try{var payload=await API.post('/api/knowledge/search',{query:query,limit:8});S.knowledgeResults=payload.results||[];render();}
  catch(error){alert(humanError(error));}
}
function workspacePage(){
  var list=(S.workspaces||[]).map(function(item){return '<button class="workspace-row" onclick="Velora.openWorkspace(\''+escapeHtml(item.id)+'\')"><b>'+escapeHtml(item.name)+'</b><small>'+item.fileCount+' files'+(item.git?' · Git':'')+'</small></button>';}).join('');
  var detail='';
  if(S.workspace&&S.workspace.workspace){
    var ws=S.workspace.workspace;var tree=(S.workspace.tree||[]).filter(function(item){return item.type==='file';}).map(function(item){return '<button class="workspace-file" onclick="Velora.openWorkspaceFile(\''+escapeHtml(item.path.replace(/'/g,"\\'"))+'\')">'+escapeHtml(item.path)+'</button>';}).join('');
    var editor=S.workspaceFile?'<div class="workspace-editor"><div class="section-head"><b>'+escapeHtml(S.workspaceFile.path)+'</b><button onclick="Velora.saveWorkspaceFile()">Review & apply</button></div><textarea id="workspace-editor" spellcheck="false">'+escapeHtml(S.workspaceFile.content||'')+'</textarea></div>':'<div class="empty-card">Choose a file to edit.</div>';
    var git=S.workspace.git||{};
    detail='<section class="workspace-detail"><div class="section-head"><div><h2>'+escapeHtml(ws.name)+'</h2><p>'+(git.repository?'Branch '+escapeHtml(git.branch||'unknown')+' · '+(git.clean?'Clean':'Changes pending'):'Not a Git repository')+'</p></div><div><button onclick="Velora.newWorkspaceFile()">New file</button><button onclick="Velora.runWorkspaceCommand(\'python-tests\')">Run tests</button><button onclick="Velora.workspaceGitDiff()">Git diff</button><button onclick="Velora.workspaceGitCommit()">'+(git.repository?'Commit':'Initialize Git')+'</button></div></div><div class="workspace-grid"><aside class="workspace-tree">'+tree+'</aside>'+editor+'</div></section>';
  }
  var docs=(S.knowledge||[]).map(function(item){return '<div class="knowledge-doc"><b>'+escapeHtml(item.name)+'</b><small>'+item.characters+' characters</small></div>';}).join('');
  var results=(S.knowledgeResults||[]).map(function(item){return '<div class="knowledge-result"><b>'+escapeHtml(item.name)+'</b><p>'+escapeHtml(item.snippet)+'</p></div>';}).join('');
  return '<div class="shell">'+accessibilityChrome()+top()+'<main id="main-content" class="page workspace-page"><div class="section-head"><div><p class="eyebrow">Projects and local knowledge</p><h1>Workspaces</h1><p class="lead">Edit project files, run restricted tests, review Git changes and search private documents locally.</p></div><button onclick="Velora.createWorkspace()">+ New workspace</button></div><div class="workspace-list">'+(list||'<div class="empty-card">No workspaces yet.</div>')+'</div>'+detail+'<section class="knowledge-section"><div class="section-head"><div><h2>Knowledge</h2><p>Text, Markdown, JSON, source files and PDFs when pdftotext is installed.</p></div><label class="btn">Add document<input id="knowledge-upload" type="file" hidden onchange="Velora.uploadKnowledge()"></label></div><div class="knowledge-search"><input id="knowledge-query" placeholder="Search your private knowledge"><button onclick="Velora.searchKnowledge()">Search</button></div><div class="knowledge-grid">'+docs+'</div><div class="knowledge-results">'+results+'</div></section>'+(S.workspaceNotice?'<pre class="workspace-output">'+escapeHtml(S.workspaceNotice)+'</pre>':'')+'</main>'+mobileBottomNav()+'</div>';
}

function modelsPage(){
  var branded=allModels(true).filter(function(model){return model.id.indexOf('veloraos-')===0;}).map(modelCard).join('');
  var other=allModels(true).filter(function(model){return model.id.indexOf('veloraos-')!==0;}).map(modelCard).join('');
  return '<div class="section-head"><div><p class="eyebrow">VeloraOS intelligence</p><h2>Models</h2><p class="lead">Install VeloraOS Tiny, Quick or Deep Thoughts for general chat. VeloraOS Coding is a separate Chat option that automatically uses the strongest installed programming model suitable for this machine. Coding model cards below show the hardware recommendation.</p></div><button class="back" onclick="Velora.go(\'home\')">Back</button></div><h3>VeloraOS models</h3><div class="cards">'+branded+'</div>'+(other?'<h3 style="margin-top:28px">Specialist models</h3><div class="cards">'+other+'</div>':'');
}
function modelCard(model){
  var installed=!!(model.availability&&model.availability.installed);var availability=model.availability||{};var isAdmin=!!(S.user&&S.user.role==='admin');var task=S.modelTasks[model.id]||null;var running=task&&['queued','downloading','running'].indexOf(String(task.status||'').toLowerCase())>=0;var failed=task&&['error','failed','cancelled'].indexOf(String(task.status||'').toLowerCase())>=0;
  var blocked=!!availability.hard_block&&!installed;var primary='';
  if(installed)primary='<button class="btn ghost" disabled>Installed</button>';
  else if(running)primary='<button class="danger-button" onclick="Velora.cancelModelDownload(\''+escapeHtml(model.id)+'\')">Cancel</button>';
  else primary='<button class="btn" '+(blocked?'disabled':'')+' onclick="Velora.installModel(\''+escapeHtml(model.id)+'\')">'+(failed?'Retry':'Install')+'</button>';
  var remove=installed&&isAdmin?'<button class="danger-button" onclick="Velora.deleteModel(\''+escapeHtml(model.id)+'\',\''+escapeHtml(model.name)+'\')">Delete model</button>':'';
  var reason=(availability.reasons||[]).join(' ');var codingBadge=model.codingRecommended?'<span class="tag coding-recommended">Best for this hardware</span>':'';var statusText=installed?'Installed and shared by every VeloraOS account.':(blocked?(reason||'Not enough free storage for this model.'):(failed?(task.error||task.output||'Download stopped. Retry when ready.'):'After install: '+(availability.storage_after_install||'storage estimate unavailable')+'. '+reason));
  var progress=task?Math.max(0,Math.min(100,Number(task.progress||0))):0;var progressText=task?[task.downloaded&&task.total?(task.downloaded+' of '+task.total):'',task.speed,task.eta?('ETA '+task.eta):'',task.output||task.status].filter(Boolean).join(' · '):'';
  return '<div class="model-card" id="model-'+escapeHtml(model.id)+'"><span class="tag '+(String(model.kind).indexOf('CPU')>=0?'':'warn')+'">'+escapeHtml(model.kind)+'</span>'+codingBadge+'<h3>'+escapeHtml(model.name)+'</h3><p class="muted">'+escapeHtml(model.tag)+'</p><div class="kv"><div><small>Download</small><b>'+escapeHtml(model.download)+'</b></div><div><small>Free space after</small><b>'+escapeHtml(availability.storage_after_install||'Unknown')+'</b></div></div>'+(task?'<div class="progress"><span style="width:'+progress+'%"></span></div><p class="small muted model-progress-copy">'+escapeHtml(progressText)+'</p>':'')+'<p class="small muted status-line">'+escapeHtml(statusText)+'</p><div class="model-actions">'+primary+remove+'</div></div>';
}
async function installModel(id){
  var model=allModels(true).find(function(item){return item.id===id;});if(!model)return;
  var availability=model.availability||{};
  if(availability.hard_block){
    var msg=(availability.reasons||['There is not enough free disk space.']).join(' ');
    pushNotification({id:'model-space-'+id+'-'+Date.now(),type:'warning',title:'Model download blocked',message:model.name+': '+msg,action:'models',actionLabel:'Open Models',priority:'warning'});
    render();return;
  }
  S.modelTasks[id]={kind:'model',model_id:id,status:'queued',progress:0,output:'Preparing background download…'};
  render();
  try{
    var start=await API.post('/api/models/'+encodeURIComponent(id)+'/install',{force:true,riskAccepted:true});
    S.modelTasks[id].id=start.task_id;
    S.modelTasks[id].task_id=start.task_id;
    startBackgroundPolling();
    await loadBackgroundTasks();
  }catch(error){
    S.modelTasks[id]=Object.assign({},S.modelTasks[id]||{},{status:'error',error:humanError(error)});
    pushNotification({id:'model-failed-'+id+'-'+Date.now(),type:'warning',title:model.name+' download failed',message:humanError(error),action:'models',actionLabel:'Retry',priority:'warning'});
    render();
  }
}

async function cancelModelDownload(id){var task=S.modelTasks[id];if(!task||!task.task_id)return;try{await API.post('/api/tasks/'+encodeURIComponent(task.task_id)+'/cancel',{});task.status='cancelled';task.output='Download cancelled.';S.modelTasks[id]=task;render();}catch(error){pushNotification({id:'model-cancel-error-'+id+'-'+Date.now(),type:'warning',title:'Could not cancel download',message:humanError(error),action:'models',actionLabel:'Open Models',priority:'warning'});render();}}
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
function diagnosticsPage(embedded){
  var d=S.diagnostics||{};if(!S.diagnostics)return embedded?'<div class="panel"><p>Loading diagnostics…</p></div>':'<div class="section-head"><div><p class="eyebrow">Hardware intelligence</p><h2>GPU & Ollama Diagnostics</h2></div></div><div class="panel"><p>Loading diagnostics…</p></div>';
  if(d.error)return embedded?'<div class="panel"><div class="diagnostic-panel-head"><h3>Diagnostics</h3><button class="btn ghost" onclick="Velora.refreshDiagnostics()">Retry</button></div><p class="error-text">'+escapeHtml(d.error)+'</p></div>':'<div class="section-head"><div><p class="eyebrow">Hardware intelligence</p><h2>GPU & Ollama Diagnostics</h2></div><button class="back" onclick="Velora.refreshDiagnostics()">Retry</button></div><div class="panel"><p class="error-text">'+escapeHtml(d.error)+'</p></div>';
  var virtual=d.virtualization||{};var gpu=d.gpu||{};var memory=d.memory||{};var ollama=d.ollama||{};var runtimes=d.runtimes||{};
  var warnings=(d.warnings||[]).map(function(item){return '<li>'+escapeHtml(item)+'</li>';}).join('');
  return (embedded?'<div class="system-info-section-head"><div><p class="eyebrow">Hardware intelligence</p><h2>Diagnostics</h2><p class="lead">Linux, VM, GPU runtime and Ollama health.</p></div><button class="btn ghost" onclick="Velora.refreshDiagnostics()" '+(S.diagnosticsBusy?'disabled':'')+'>'+(S.diagnosticsBusy?'Refreshing…':'Refresh diagnostics')+'</button></div>':'<div class="section-head"><div><p class="eyebrow">Hardware intelligence</p><h2>GPU & Ollama Diagnostics</h2><p class="lead">See exactly what Linux, the VM, the GPU runtimes and Ollama can use.</p></div><div class="section-actions"><button class="btn ghost" onclick="Velora.refreshDiagnostics()" '+(S.diagnosticsBusy?'disabled':'')+'>'+(S.diagnosticsBusy?'Refreshing…':'Refresh diagnostics')+'</button><button class="back" onclick="Velora.go(\'home\')">Back</button></div></div>')+(warnings?'<div class="diagnostic-warning"><b>Needs attention</b><ul>'+warnings+'</ul></div>':'')+'<div class="diagnostic-summary">'+diagnosticFact('Environment',virtual.isVirtual?('Virtual · '+virtual.type):'Physical',virtual.product)+diagnosticFact('GPU passthrough',gpu.passthroughDetected?'Detected':(virtual.isVirtual?'Not detected':'Not required'))+diagnosticFact('System memory',memory.used+' / '+memory.total,(memory.usedPercent||0)+'% used')+diagnosticFact('Ollama',ollama.ready?'Ready':'Not ready',ollama.version?('Version '+ollama.version):ollama.message)+'</div><section class="panel diagnostic-panel"><div class="diagnostic-panel-head"><div><p class="eyebrow">PCI hardware</p><h3>Physical GPU and passthrough</h3></div>'+diagnosticBadge((gpu.physicalDevices||[]).length>0,(gpu.physicalDevices||[]).length+' GPU detected','CPU only')+'</div>'+diagnosticGpuRows()+diagnosticVramRows()+'</section><section class="panel diagnostic-panel"><div class="diagnostic-panel-head"><div><p class="eyebrow">Runtime health</p><h3>CUDA, ROCm and Vulkan</h3></div></div><div class="diagnostic-runtime-grid">'+runtimeDiagnosticCard('CUDA',runtimes.cuda)+runtimeDiagnosticCard('ROCm',runtimes.rocm)+runtimeDiagnosticCard('Vulkan',runtimes.vulkan)+'</div></section><section class="panel diagnostic-panel"><div class="diagnostic-panel-head"><div><p class="eyebrow">Ollama process state</p><h3>CPU/GPU model usage</h3><p class="muted">Ollama reports model placement only while a model is loaded.</p></div>'+diagnosticBadge(!!ollama.ready,ollama.installedModelCount+' installed','Offline')+'</div>'+loadedModelRows()+'</section>'+accelerationTestHtml();
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
  var chatRows=filteredChats().map(function(chat){var active=S.active===chat.id;return '<div class="chat-row '+(active?'active':'')+'"><button class="chat-item" '+(active?'aria-current="true" ':'')+'onclick="Velora.openChat(\''+chat.id+'\')">'+escapeHtml(chat.title||'New chat')+'</button><button class="chat-delete" onclick="Velora.deleteChat(\''+chat.id+'\')" aria-label="Delete '+escapeHtml(chat.title||'chat')+'" title="Delete chat">&times;</button></div>';}).join('');
  var modelRows=chatModelOptions().map(function(model){var selected=model.id===S.selected;return '<button class="model-option" role="option" aria-selected="'+(selected?'true':'false')+'" onclick="Velora.selectModel(\''+escapeHtml(model.id)+'\')"><b>'+escapeHtml(model.name)+'</b><small>'+escapeHtml(model.kind)+'</small></button>';}).join('');
  var sidebar='<aside id="chat-history-drawer" class="chat-sidebar'+(S.mobileChatsOpen?' open':'')+'" aria-label="Chat history"><div class="mobile-drawer-head"><b id="chat-history-title">Chats</b><button id="mobile-drawer-close" type="button" onclick="Velora.toggleMobileChats(false)" aria-label="Close chat history">&times;</button></div><button class="new-chat" onclick="Velora.newChat()">+ New chat</button><label class="sr-only" for="chat-search">Search chats</label><input id="chat-search" class="search" type="search" placeholder="Search titles and messages" value="'+escapeHtml(S.search)+'" oninput="Velora.setSearch(this.value)"><div class="chat-list" aria-label="Saved chats">'+chatRows+'</div></aside>';
  var backdrop=S.mobileChatsOpen?'<button class="chat-drawer-backdrop" type="button" onclick="Velora.toggleMobileChats(false)" aria-label="Close chat history"></button>':'';
  return '<div class="shell">'+accessibilityChrome()+top()+'<main id="main-content" class="chat-wrap" tabindex="-1">'+sidebar+backdrop+'<section class="chat-main" aria-label="Chat workspace"><div class="chat-top"><div class="chat-title-group"><button id="mobile-chats-button" class="mobile-chats-button" type="button" onclick="Velora.toggleMobileChats(true)" aria-label="Open chat history" aria-controls="chat-history-drawer" aria-expanded="'+(S.mobileChatsOpen?'true':'false')+'">&#9776;</button><h1 class="chat-top-title">'+escapeHtml(currentTitle())+'</h1><button class="chat-title-action" onclick="Velora.renameChat()">Rename</button></div><div class="chat-top-actions"><button onclick="Velora.exportChat(\'markdown\')">Export Markdown</button><button onclick="Velora.exportChat(\'json\')">Export JSON</button><button id="lockdown-mode-button" class="lockdown-mode-button '+(S.lockdownMode?'active':'')+'" type="button" onclick="Velora.toggleLockdownMode()" aria-pressed="'+(S.lockdownMode?'true':'false')+'" title="Lockdown mode keeps VeloraOS fully offline and blocks all web search and external page fetching.">'+escapeHtml(lockdownButtonLabel())+'</button><div class="model-picker"><button id="model-picker-button" class="model-button" onclick="Velora.toggleModelMenu()" aria-haspopup="listbox" aria-expanded="'+(S.menu?'true':'false')+'" aria-controls="model-picker-menu">'+escapeHtml(modelName(S.selected))+' &#9662;</button><div id="model-picker-menu" class="model-menu '+(S.menu?'open':'')+'" role="listbox" aria-label="Installed models">'+modelRows+'</div></div></div></div><div class="messages" id="messages" role="log" aria-live="polite" aria-relevant="additions text" aria-busy="'+(S.busy?'true':'false')+'"><div class="messages-inner" id="messages-inner">'+(S.error?'<div class="chat-error" role="alert">'+escapeHtml(S.error)+'</div>':'')+(S.chatNotice?'<div class="chat-notice" role="status">'+escapeHtml(S.chatNotice)+'</div>':'')+(S.msgs.length?S.msgs.map(messageHtml).join(''):emptyChat())+(S.busy?thinkingMessageHtml():'')+'</div></div><div class="composer-wrap"><div class="composer-stack">'+(editing?'<div class="edit-banner" role="status"><div><b>Editing an earlier message</b><span>Sending will replace every response after it.</span></div><button type="button" onclick="Velora.cancelEditMessage()">Cancel</button></div>':'')+'<div class="composer-toolbar"><div class="composer-toolbar-left"><button class="upload-btn" type="button" onclick="Velora.openImagePicker()">Upload image</button><input id="image-input" type="file" accept="image/*" multiple hidden><span class="vision-chip">Paste images straight into chat &middot; use Moondream/LLaVA for vision</span></div><div class="composer-toolbar-right">'+cosmicReasoningHtml()+'</div></div>'+pendingImagesHtml()+'<div class="composer"><label class="sr-only" for="prompt">Message VeloraOS</label><textarea id="prompt" aria-describedby="composer-hint" placeholder="'+(editing?'Edit this message and resend&hellip;':'Message VeloraOS or paste an image&hellip;')+'" rows="1">'+escapeHtml(promptValue)+'</textarea>'+(S.busy?'<button class="send stop" id="send-btn" onclick="Velora.stopGeneration()" aria-label="Stop generation" title="Stop generation">&#9632;</button>':'<button class="send" id="send-btn" onclick="Velora.send()" aria-label="Send message">&rarr;</button>')+'</div><div class="hint" id="composer-hint">Enter to send &middot; Shift+Enter for a new line &middot; copy, edit, regenerate, rename and export are available above</div></div></div></section></main>'+mobileBottomNav()+'</div>';
}
function captureChatViewport(){
  var box=$('#messages');
  if(!box)return null;
  return {top:box.scrollTop,atBottom:(box.scrollHeight-box.scrollTop-box.clientHeight)<90};
}
function afterChat(previousViewport){
  var input=$('#prompt');
  if(input){
    input.addEventListener('input',function(){this.style.height='auto';this.style.height=Math.min(this.scrollHeight,180)+'px';if(S.editingIndex!==null)S.editingDraft=this.value;});
    input.addEventListener('keydown',function(event){if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();send();}});
    input.addEventListener('paste',handlePaste);
    input.style.height='auto';input.style.height=Math.min(input.scrollHeight,180)+'px';
    if(S.editingIndex!==null){input.focus();input.setSelectionRange(input.value.length,input.value.length);}
  }
  var picker=$('#image-input');
  if(picker){picker.addEventListener('change',function(event){Velora.handleImageFiles(event.target.files);this.value='';});}
  var box=$('#messages');
  if(box){
    if(S.chatScrollIntent==='bottom'||!previousViewport||previousViewport.atBottom){
      box.scrollTop=box.scrollHeight;
    }else{
      box.scrollTop=Math.min(previousViewport.top,Math.max(0,box.scrollHeight-box.clientHeight));
    }
  }
  S.chatScrollIntent='';
}
function scrollChat(){var box=$('#messages');if(box)box.scrollTop=box.scrollHeight;}
function filteredChats(){var query=S.search.toLowerCase().trim();return S.chats.filter(function(chat){if(!query)return true;var haystack=[chat.title||''].concat((chat.messages||[]).map(function(message){return message.content||'';})).join('\n').toLowerCase();return haystack.indexOf(query)>=0;});}
function currentTitle(){var chat=S.chats.find(function(item){return item.id===S.active;});return chat&&chat.title?chat.title:'New chat';}
function modelName(id){var model=chatModelOptions().find(function(item){return item.id===id;});return model?model.name:'VeloraOS Automatic';}
function lockdownButtonLabel(){return S.lockdownMode?'🛡 Lockdown On':'🛡 Lockdown';}
async function toggleLockdownMode(){
  S.lockdownMode=!S.lockdownMode;
  S.settings=Object.assign({},S.settings,{lockdown_mode:!!S.lockdownMode});
  var button=$('#lockdown-mode-button');
  if(button){button.textContent=lockdownButtonLabel();button.classList.toggle('active',!!S.lockdownMode);button.setAttribute('aria-pressed',S.lockdownMode?'true':'false');}
  announce(S.lockdownMode?'Lockdown mode enabled. VeloraOS is offline-only and will not search or fetch anything from the web.':'Lockdown mode disabled. VeloraOS will automatically use the web when fresh information is useful.');
  try{await API.post('/api/settings',{settings:S.settings});}catch(error){S.lockdownMode=!S.lockdownMode;S.settings=Object.assign({},S.settings,{lockdown_mode:!!S.lockdownMode});render();alert(humanError(error));}
}
function activeChatTask(){return S.active&&S.chatTasks[S.active];}
function thinkingStatusText(){var task=activeChatTask();return String((task&&task.output)||'Thinking…');}
function emptyChat(){return '<div class="empty-chat"><div class="empty-orb" aria-hidden="true">'+icons.chat+'</div><h2>How can I help?</h2><p>Use Automatic for everyday routing, Coding for programming, or manually select Tiny, Quick or Deep Thoughts.</p></div>';}
function thinkingMessageHtml(){
  return '<article class="msg thinking-message" aria-label="VeloraOS is working"><span class="avatar assistant">V</span><div class="msg-content"><div class="msg-role">VeloraOS</div><div class="msg-body thinking-body"><span class="typing" role="status" aria-label="VeloraOS is working"><span></span><span></span><span></span></span><span id="thinking-status" class="thinking-status">'+escapeHtml(thinkingStatusText())+'</span></div></div></article>';
}
function updateThinkingStatus(){var element=$('#thinking-status');if(element)element.textContent=thinkingStatusText();}
function messageHtml(message,index){var speaker=message.role==='user'?((S.user&&S.user.display_name)||'You'):'VeloraOS';var body=message.role==='assistant'?renderMarkdown(message.content||''):('<p>'+inlineMarkdown(message.content||'').replace(/\n/g,'<br>')+'</p>');return '<article class="msg" data-message-index="'+index+'" aria-label="Message from '+escapeHtml(speaker)+'">'+chatAvatar(message.role)+'<div class="msg-content"><div class="msg-role">'+escapeHtml(speaker)+'</div><div class="msg-body">'+imageStrip(message.images)+body+'</div>'+messageStatsHtml(message)+messageActionsHtml(message,index)+'</div></article>';}
function setSearch(value){S.search=value;render();}
function toggleMobileChats(open){S.mobileChatsOpen=typeof open==='boolean'?open:!S.mobileChatsOpen;S.menu=false;render();focusAfterRender(S.mobileChatsOpen?'#mobile-drawer-close':'#mobile-chats-button');}
function toggleModelMenu(){S.menu=!S.menu;render();focusAfterRender(S.menu?'.model-option':'#model-picker-button');}
function selectModel(id){
  S.selected=id;S.menu=false;
  var chat=S.chats.find(function(item){return item.id===S.active;});
  if(chat){chat.model=id;chat.updatedAt=new Date().toISOString();saveChats();}
  var button=$('#model-picker-button');
  if(button){button.innerHTML=escapeHtml(modelName(id))+' &#9662;';button.setAttribute('aria-expanded','false');}
  var menu=$('#model-picker-menu');
  if(menu){menu.classList.remove('open');menu.querySelectorAll('.model-option').forEach(function(option){option.setAttribute('aria-selected','false');});}
  announce('Selected model '+modelName(id)+' for the next message.');
}
function newChat(){var id=(window.crypto&&crypto.randomUUID)?crypto.randomUUID():String(Date.now());S.active=id;S.busy=false;S.chatScrollIntent='bottom';S.msgs=[];S.pendingImages=[];S.error='';S.chatNotice='';S.editingIndex=null;S.editingDraft='';S.mobileChatsOpen=false;S.chats=[{id:id,title:'New chat',model:S.selected,messages:[],createdAt:new Date().toISOString()}].concat(S.chats);saveChats();render();}
function normaliseChatModelSelection(id){
  var aliases={'tinyllama-1.1b':'veloraos-tiny','tinyllama:1.1b':'veloraos-tiny','qwen3-4b':'veloraos-quick','qwen3:4b':'veloraos-quick','veloraos-deep-thoughts':'veloraos-deep','smollm2-135m':'veloraos-auto','smollm2:135m':'veloraos-auto','smollm2-360m':'veloraos-auto','smollm2:360m':'veloraos-auto','qwen2.5-0.5b':'veloraos-auto','qwen2.5:0.5b':'veloraos-auto','qwen2.5-coder-0.5b':'veloraos-coding','qwen2.5-coder:0.5b':'veloraos-coding','qwen2.5-coder-7b':'veloraos-coding','qwen2.5-coder:7b':'veloraos-coding'};
  var value=String(id||'veloraos-auto');
  value=aliases[value]||value;
  return ['veloraos-auto','veloraos-coding','veloraos-tiny','veloraos-quick','veloraos-deep'].indexOf(value)>=0?value:'veloraos-auto';
}
function openChat(id){var chat=S.chats.find(function(item){return item.id===id;});if(!chat)return;S.chatScrollIntent='bottom';S.active=id;S.msgs=chat.messages||[];S.selected=normaliseChatModelSelection(chat.model||S.selected);S.pendingImages=[];S.error='';S.chatNotice='';S.editingIndex=null;S.editingDraft='';S.mobileChatsOpen=false;syncActiveChatBusy();render();}
async function deleteChat(id){
  var chat=S.chats.find(function(item){return item.id===id;});if(!chat)return;
  if(!window.confirm('Delete “'+(chat.title||'New chat')+'”? This cannot be undone.'))return;
  S.chats=S.chats.filter(function(item){return item.id!==id;});
  if(S.active===id){var next=S.chats[0]||null;if(next){S.active=next.id;S.msgs=next.messages||[];S.selected=next.model||S.selected;}else{S.active=null;S.msgs=[];}S.pendingImages=[];S.error='';S.editingIndex=null;S.editingDraft='';}
  await saveChats();render();
}
async function saveChats(){localStorage.setItem(localChatKey(),JSON.stringify(S.chats));try{await API.post('/api/chats',{chats:S.chats});}catch(error){if(error.status===401)showLogin('Your session expired.');}}
function saveActive(){var chat=S.chats.find(function(item){return item.id===S.active;});if(!chat)return saveChats();chat.messages=S.msgs;chat.model=S.selected;chat.updatedAt=new Date().toISOString();if(!chat.createdAt)chat.createdAt=chat.updatedAt;if(!chat.title||chat.title==='New chat'){chat.title=(S.msgs.find(function(message){return message.role==='user';})||{}).content||chat.title||'New chat';if(chat.title.length>42)chat.title=chat.title.slice(0,42);}return saveChats();}
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
  if(!S.busy||!S.active)return;
  var task=S.chatTasks[S.active];
  if(!task||!task.id){S.busy=false;render();return;}
  S.stopRequested=true;
  try{
    var stopped=await API.post('/api/tasks/'+encodeURIComponent(task.id)+'/cancel',{});
    S.chatTasks[S.active]=stopped;
    S.chatNotice='Generation cancelled.';
  }catch(error){S.error=humanError(error);}
  S.busy=false;S.stopRequested=false;render();
}
async function performGeneration(){
  if(!chatModelOptions().some(function(model){return model.id!=='veloraos-auto';})){S.error='Install VeloraOS Tiny or VeloraOS Quick from Models before starting a chat.';render();return;}
  if(S.busy||!S.msgs.length||!S.active)return;
  S.busy=true;S.error='';S.chatNotice='VeloraOS is generating this response in the background. You can leave Chat or close the app.';S.chatScrollIntent='bottom';render();
  try{
    var model=allModels().find(function(item){return item.id===S.selected;});
    var start=await API.post('/api/chat/tasks',{
      chat_id:S.active,
      model:model&&model.tag?model.tag:S.selected,
      model_id:S.selected,
      messages:serializableMessages(),
      reasoning_power:S.reasoning
    });
    S.chatTasks[S.active]={id:start.task_id,task_id:start.task_id,kind:'chat',chat_id:S.active,status:start.status||'queued',model:start.model,selected_profile:start.selected_profile,selected_profile_name:start.selected_profile_name,route_reason:start.route_reason,lockdown_mode:!!start.lockdown_mode,web_used:!!start.web_planned,output:start.web_planned?'Preparing web search…':'Thinking…'};
    S.chatNotice=(S.selected==='veloraos-auto'?'Automatic selected '+(start.selected_profile_name||'a model')+' · '+(start.route_reason||'Best match'):'Using '+(start.selected_profile_name||modelName(S.selected)))+'. You can leave Chat while it works.';
    startBackgroundPolling(false);
    render();
  }catch(error){
    S.busy=false;
    S.error=humanError(error);
    if(error.status===401){showLogin('Your session expired.');return;}
    render();
  }
}
async function send(){
  if(!chatModelOptions().some(function(model){return model.id!=='veloraos-auto';})){S.error='Install VeloraOS Tiny or VeloraOS Quick from Models before starting a chat.';render();return;}
  syncActiveChatBusy();
  var input=$('#prompt');var prompt=input&&input.value.trim();var queued=S.pendingImages.slice();
  if((!prompt&&!queued.length)||S.busy)return;
  if(!S.active)newChat();
  var effectivePrompt=prompt||('Please describe the uploaded image'+(queued.length>1?'s.':'.'));
  var message={role:'user',content:effectivePrompt,images:queued,createdAt:new Date().toISOString()};
  if(S.editingIndex!==null){
    var index=S.editingIndex;S.msgs=S.msgs.slice(0,index);S.msgs.push(message);S.editingIndex=null;S.editingDraft='';S.chatNotice='Conversation updated from the edited message.';
  }else S.msgs.push(message);
  S.pendingImages=[];
  await saveActive();
  await performGeneration();
}
async function regenerateMessage(index){
  if(S.busy)return;
  var message=S.msgs[index];if(!message||message.role!=='assistant')return;
  var previous=-1;for(var i=index-1;i>=0;i--){if(S.msgs[i].role==='user'){previous=i;break;}}
  if(previous<0)return;
  S.msgs=S.msgs.slice(0,index);S.chatNotice='Regenerating the response in the background…';
  await saveActive();
  await performGeneration();
}

function setupDone(step){
  var x=S.setup||{};
  return {1:!!x.passwordChanged,2:!!x.deviceNamed,3:!!x.licenseReady,4:!!x.hardwareChecked,5:!!x.ollamaChecked,6:!!x.modelInstalled,7:!!x.ready}[step];
}
function setupStepsHtml(){
  var labels=['Password','Device','Licence','Hardware','Ollama','Model','Ready'];
  return '<nav class="setup-steps" aria-label="Setup progress">'+labels.map(function(label,index){var n=index+1;var active=S.setupStep===n;var done=setupDone(n);return '<button class="setup-step '+(active?'active ':'')+(done?'done':'')+'" '+(active?'aria-current="step" ':'')+'aria-label="Step '+n+': '+label+(done?', completed':'')+'" onclick="Velora.setSetupStep('+n+')"><span aria-hidden="true">'+(done?'✓':n)+'</span><b>'+label+'</b></button>';}).join('')+'</nav>';
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
  var m=(S.setup&&S.setup.recommendation)||{};var choices=(S.setup&&S.setup.starterModels)||[];var installed=!!(S.setup&&S.setup.modelInstalled);var d=S.setupDownload;var selected=S.setupModelSelection||[];
  var progress=d?'<div class="setup-download"><div class="progress"><span style="width:'+Math.max(0,Math.min(100,Number(d.progress||0)))+'%"></span></div><p>'+escapeHtml([d.downloaded&&d.total?(d.downloaded+' of '+d.total):'',d.speed,d.eta?('ETA '+d.eta):'',d.output||d.status].filter(Boolean).join(' · '))+'</p>'+(d.task_id&&['queued','downloading','running'].indexOf(String(d.status||'').toLowerCase())>=0?'<button class="danger-button" onclick="Velora.cancelSetupDownload()">Cancel current download</button>':'')+'</div>':'';
  var cards=choices.map(function(model){var available=model.availability||{};var checked=selected.indexOf(model.id)>=0||!!available.installed;var blocked=!!available.hard_block&&!available.installed;return '<label class="setup-model-choice '+(checked?'selected ':'')+(available.installed?'installed ':'')+(blocked?'blocked':'')+'"><input type="checkbox" value="'+escapeHtml(model.id)+'" '+(checked?'checked ':'')+(available.installed||blocked||S.setupBusy?'disabled ':'')+'onchange="Velora.toggleSetupModel(\''+escapeHtml(model.id)+'\',this.checked)"><span class="setup-model-choice-copy"><span class="setup-model-choice-head"><b>'+escapeHtml(model.name)+'</b>'+(model.recommended?'<span class="tag">Recommended</span>':'')+(available.installed?'<span class="tag">Installed</span>':'')+'</span><small>'+escapeHtml(model.kind)+' &middot; '+escapeHtml(model.download)+'</small><span>'+escapeHtml(model.desc||'Local Chat model.')+'</span></span></label>';}).join('');
  return '<div class="setup-step-card '+(installed?'success-card':'')+'"><p class="eyebrow">Starter models</p><h2>'+(installed?'Your Chat models are ready':'Choose models for Chat')+'</h2><p class="lead">Select one or more local models to download now. VeloraOS recommends <b>'+escapeHtml(m.name||'a starter model')+'</b> for this hardware.</p><div class="setup-model-grid">'+cards+'</div>'+progress+'<div class="setup-actions"><button class="btn" '+(S.setupBusy||installed||!selected.length?'disabled':'')+' onclick="Velora.installSetupModel()">'+(installed?'Selected models installed':('Download '+selected.length+' model'+(selected.length===1?'':'s')))+'</button></div><p id="setup-action-status" class="small" role="status" aria-live="polite">'+(!selected.length?'Select at least one model so Chat is ready when setup finishes.':'Downloads run one at a time and remain available to every account.')+'</p></div>';
}
function setupReadinessStep(){
  var x=S.setup||{};var blockers=x.blockers||[];var warnings=x.warnings||[];
  return '<div class="setup-step-card '+(x.ready?'success-card':'')+'"><p class="eyebrow">Final readiness test</p><h2>'+(x.ready?'VeloraOS is ready':'Finish the remaining setup checks')+'</h2><p class="lead">The final test verifies the required security, licence and local-runtime setup before opening the dashboard.</p><div class="readiness-list"><div><h3>Required checks</h3>'+(blockers.length?blockers.map(function(item){return '<p class="readiness-item blocked"><span>!</span>'+escapeHtml(item)+'</p>';}).join(''):'<p class="readiness-item ready"><span>✓</span>All required checks passed.</p>')+'</div>'+(warnings.length?'<div><h3>Warnings</h3>'+warnings.map(function(item){return '<p class="readiness-item warning"><span>•</span>'+escapeHtml(item)+'</p>';}).join('')+'</div>':'')+'</div><div class="setup-actions"><button class="btn ghost" '+(S.setupBusy?'disabled':'')+' onclick="Velora.runSetupReadiness()">Run readiness test</button><button class="btn" '+(!x.ready||S.setupBusy?'disabled':'')+' onclick="Velora.finishSetup()">Finish setup</button></div><p id="setup-action-status" class="small" role="status" aria-live="polite"></p></div>';
}
function setupStepContent(){return [null,setupPasswordStep,setupDeviceStep,setupLicenceStep,setupHardwareStep,setupOllamaStep,setupModelStep,setupReadinessStep][S.setupStep]();}
function setupDeviceDraftValue(){return String(S.setupDeviceDraft!==null?S.setupDeviceDraft:((S.setup&&S.setup.deviceName)||'')).trim();}
function setupCanContinue(){if(S.setupStep===2){var value=setupDeviceDraftValue();return !!value&&value!=='VeloraOS device';}return setupDone(S.setupStep);}
function setupCompletePage(){var installed=allModels().filter(function(model){return model.availability&&model.availability.installed;});return '<div class="setup-shell">'+accessibilityChrome()+'<main id="main-content" class="setup-main setup-complete-main" tabindex="-1"><section class="setup-step-card success-card setup-finish-card"><div class="setup-ready-orb">✓</div><p class="eyebrow">Setup complete</p><h1>VeloraOS is ready</h1><p class="lead">Your local AI system is configured and ready to use.</p><div class="setup-facts">'+setupFact('Installed models',String(installed.length))+setupFact('Device',(S.setup&&S.setup.deviceName)||'VeloraOS')+setupFact('Licence',licenseStateLabel(((S.setup&&S.setup.license)||S.license||{}).status))+setupFact('Acceleration',(S.system&&S.system.acceleration)||'CPU only')+'</div><div class="setup-actions"><button class="btn" data-page="chat" onclick="Velora.enterVelora(this.dataset.page)">Start chatting</button><button class="btn ghost" data-page="home" onclick="Velora.enterVelora(this.dataset.page)">Open Home</button></div></section></main></div>';}
function setupPage(){
  if(S.setupComplete)return setupCompletePage();
  var optional=S.setup&&S.setup.optionalRun&&!S.setup.required;
  return '<div class="setup-shell">'+accessibilityChrome()+'<header class="setup-header"><div class="brand"><div class="logo" role="img" aria-label="VeloraOS">V</div><div><h1>VeloraOS</h1><p>First-run setup</p></div></div><div class="setup-header-copy"><span class="tag">VeloraOS 1.10.28</span><strong>Step '+S.setupStep+' of 7</strong></div>'+(optional?'<button class="btn ghost" onclick="Velora.cancelSetup()">Exit setup</button>':'')+'</header><main id="main-content" class="setup-main" tabindex="-1">'+setupStepsHtml()+'<section class="setup-content" aria-label="Setup step '+S.setupStep+'">'+setupStepContent()+'<div class="setup-footer"><button class="btn ghost" '+(S.setupBusy||S.setupStep<=1?'disabled':'')+' onclick="Velora.setupBack()">Back</button><button id="setup-continue" class="btn ghost" '+(S.setupBusy||S.setupStep>=7||!setupCanContinue()?'disabled':'')+' onclick="Velora.setupNext()">Continue</button></div></section></main></div>';
}
function afterSetupRender(){var target=document.querySelector('.setup-step-card input');if(target&&S.setupStep===1&&!setupDone(1))setTimeout(function(){target.focus();},0);}
function finishSetupTransition(step){S.setupBusy=false;if(step!==undefined&&step!==null)S.setupStep=Math.max(1,Math.min(7,Number(step)||1));render();}
function updateSetupDeviceDraft(value){S.setupDeviceDraft=String(value||'');var button=document.getElementById('setup-continue');if(button)button.disabled=S.setupBusy||S.setupStep>=7||!setupCanContinue();}
function setSetupStep(step){if(S.setupBusy)return;step=Math.max(1,Math.min(7,Number(step)||1));if(step>S.setupStep&&!setupDone(S.setupStep))return;S.setupStep=step;render();}
function setupBack(){if(!S.setupBusy&&S.setupStep>1){S.setupStep--;render();}}
function setupNext(){
  if(S.setupBusy)return;
  if(S.setupStep===2){var saved=String((S.setup&&S.setup.deviceName)||'').trim();var draft=setupDeviceDraftValue();if(!setupDone(2)||draft!==saved){saveSetupDeviceName(true);return;}}
  if(S.setupStep<7&&setupDone(S.setupStep))finishSetupTransition(S.setupStep+1);
}
async function refreshSetup(){await loadSetupStatus();S.license=S.setup&&S.setup.license?S.setup.license:S.license;}
async function changeSetupPassword(){
  var current=($('#setup-current-password')||{}).value||'';var next=($('#setup-new-password')||{}).value||'';var confirmValue=($('#setup-confirm-password')||{}).value||'';
  if(next!==confirmValue){setStatus('setup-action-status','The new passwords do not match.',true);return;}
  S.setupBusy=true;setStatus('setup-action-status','Changing password…',false);
  try{var result=await API.patch('/api/profile',{current_password:current,new_password:next});S.user=result.user;await refreshSetup();finishSetupTransition(2);}catch(error){S.setupBusy=false;setStatus('setup-action-status',humanError(error),true);}
}
async function saveSetupDeviceName(advance){
  var name=(($('#setup-device-name')||{}).value||S.setupDeviceDraft||'').trim();
  if(!name||name==='VeloraOS device'){setStatus('setup-action-status','Enter a name for this VeloraOS system.',true);return;}
  S.setupDeviceDraft=name;S.setupBusy=true;setStatus('setup-action-status','Saving device name…',false);
  try{
    var result=await API.post('/api/setup/device-name',{deviceName:name});
    await refreshSetup();S.setupDeviceDraft=result.deviceName||name;
    finishSetupTransition(advance?3:2);
    if(!advance)setStatus('setup-action-status',result.warning||'Device name saved. Continue is now available.',!!result.warning);
  }catch(error){S.setupBusy=false;setStatus('setup-action-status',humanError(error),true);}
}
async function checkSetupLicence(){
  var key=(($('#setup-license-key')||{}).value||'').toUpperCase().replace(/\s+/g,'');S.setupBusy=true;setStatus('setup-action-status','Checking licence…',false);
  try{S.license=key?await API.post('/api/license/activate',{licenseKey:key,deviceName:S.setup.deviceName}):await API.post('/api/license/recheck',{});await refreshSetup();finishSetupTransition(S.setup.licenseReady?4:3);}catch(error){S.setupBusy=false;setStatus('setup-action-status',licenseError(error),true);}
}
async function runSetupHardware(){S.setupBusy=true;setStatus('setup-action-status','Detecting hardware…',false);try{var result=await API.post('/api/setup/hardware-test',{});S.system=result.hardware;S.setupModelSelection=null;await refreshSetup();finishSetupTransition(5);}catch(error){S.setupBusy=false;setStatus('setup-action-status',humanError(error),true);}}
async function runSetupOllama(){S.setupBusy=true;setStatus('setup-action-status','Testing Ollama…',false);try{await API.post('/api/setup/ollama-test',{});await refreshSetup();finishSetupTransition(6);}catch(error){S.setupBusy=false;setStatus('setup-action-status',humanError(error),true);}}
function toggleSetupModel(id,checked){var selected=(S.setupModelSelection||[]).slice();var index=selected.indexOf(id);if(checked&&index<0)selected.push(id);if(!checked&&index>=0)selected.splice(index,1);S.setupModelSelection=selected;render();}
async function installSetupModel(){
  var ids=(S.setupModelSelection||[]).slice();if(!ids.length){setStatus('setup-action-status','Select at least one starter model.',true);return;}S.setupBusy=true;S.setupDownload={status:'queued',progress:0,output:'Preparing model downloads...'};render();
  try{await API.post('/api/setup/model',{modelIds:ids,skipped:false});for(var modelIndex=0;modelIndex<ids.length;modelIndex++){var modelId=ids[modelIndex];var model=((S.setup&&S.setup.starterModels)||[]).find(function(item){return item.id===modelId;})||{name:modelId,availability:{}};if(model.availability&&model.availability.installed)continue;if(model.availability&&model.availability.hard_block)throw new Error((model.availability.reasons||['Not enough free storage for '+model.name+'.']).join(' '));S.setupDownload={status:'queued',progress:0,output:'Model '+(modelIndex+1)+' of '+ids.length+': '+model.name};render();var start=await API.post('/api/models/'+encodeURIComponent(modelId)+'/install',{force:true,riskAccepted:true});S.setupDownload.task_id=start.task_id;var finished=false;for(var i=0;i<720;i++){await new Promise(function(resolve){setTimeout(resolve,1000);});var task=await API.get('/api/tasks/'+encodeURIComponent(start.task_id));task.output='Model '+(modelIndex+1)+' of '+ids.length+': '+(task.output||task.status);S.setupDownload=task;render();var state=String(task.status||'').toLowerCase();if(['complete','completed','done','success'].indexOf(state)>=0){finished=true;pushNotification({id:'setup-model-'+modelId+'-'+Date.now(),type:'model',title:model.name+' installed',message:'Starter model '+(modelIndex+1)+' of '+ids.length+' is ready.',action:'models',actionLabel:'Open Models',priority:'success'});break;}if(state==='cancelled')throw new Error('The '+model.name+' download was cancelled.');if(['error','failed'].indexOf(state)>=0)throw new Error(task.error||('Install failed for '+model.name));}if(!finished)throw new Error('The model download did not finish in time.');}await refreshSetup();S.setupDownload=null;S.setupBusy=false;S.setupStep=7;render();}
  catch(error){S.setupBusy=false;pushNotification({id:'setup-model-failed-'+Date.now(),type:'warning',title:'Starter model download needs attention',message:humanError(error),action:'models',actionLabel:'Open Models',priority:'warning'});setStatus('setup-action-status',humanError(error),true);render();}
}
async function cancelSetupDownload(){var task=S.setupDownload;if(!task||!task.task_id)return;try{await API.post('/api/tasks/'+encodeURIComponent(task.task_id)+'/cancel',{});S.setupBusy=false;S.setupDownload=Object.assign({},task,{status:'cancelled',output:'Download cancelled. You can retry.'});render();}catch(error){setStatus('setup-action-status',humanError(error),true);}}
async function skipSetupModel(){S.setupBusy=true;try{await API.post('/api/setup/model',{modelId:(S.setup.recommendation||{}).id||null,skipped:true});await refreshSetup();finishSetupTransition(7);}catch(error){S.setupBusy=false;setStatus('setup-action-status',humanError(error),true);}}
async function runSetupReadiness(){S.setupBusy=true;setStatus('setup-action-status','Running final checks…',false);try{S.setup=await API.post('/api/setup/readiness',{});finishSetupTransition(7);}catch(error){S.setupBusy=false;setStatus('setup-action-status',humanError(error),true);}}
async function finishSetup(){S.setupBusy=true;setStatus('setup-action-status','Finishing setup…',false);try{S.setup=await API.post('/api/setup/complete',{});await loadCore();if(S.user.role==='admin')await loadUpdateStatus();S.setupBusy=false;S.setupComplete=true;pushNotification({id:'setup-complete-'+Date.now(),type:'success',title:'VeloraOS setup complete',message:'Your local AI system is ready to use.',action:'chat',actionLabel:'Start chatting',priority:'success'});render();startUpdatePolling();}catch(error){S.setupBusy=false;setStatus('setup-action-status',humanError(error),true);}}
function enterVelora(page){S.setupComplete=false;S.page=page||'home';render();}
async function startSetupWizard(){try{await API.post('/api/setup/reset',{});S.setupModelSelection=null;await refreshSetup();await loadSetupCore();S.setupDeviceDraft=null;S.setupStep=1;S.page='setup';stopUpdatePolling();render();}catch(error){alert(humanError(error));}}
async function cancelSetup(){try{await API.post('/api/setup/cancel',{});await refreshSetup();S.page='settings';render();startUpdatePolling();}catch(error){alert(humanError(error));}}

function studioPage(title,lead,message){return '<div class="section-head"><div><p class="eyebrow">VeloraOS Studio</p><h2>'+escapeHtml(title)+'</h2><p class="lead">'+escapeHtml(lead)+'</p></div><button class="back" onclick="Velora.go(\'home\')">Back</button></div><div class="panel"><h3>'+escapeHtml(message)+'</h3><p class="muted">GPU readiness: '+escapeHtml(status())+'</p><button class="btn ghost" onclick="Velora.go(\'models\')">View compatible models</button></div>';}
function optionList(values,selected){return values.map(function(value){return '<option value="'+escapeHtml(value)+'" '+(String(value)===String(selected)?'selected':'')+'>'+escapeHtml(value)+'</option>';}).join('');}
function imageHistoryCard(item){var prompt=String(item.prompt||'Generated image');var url=String(item.url||('/api/image-studio/images/'+item.id));var download=String(item.downloadUrl||(url+'?download=true'));return '<article class="studio-image-card"><a class="studio-preview" href="'+escapeHtml(url)+'" target="_blank" rel="noopener" aria-label="Open full-size image: '+escapeHtml(prompt)+'"><img src="'+escapeHtml(url)+'" alt="'+escapeHtml(prompt)+'" loading="lazy"></a><div class="studio-image-copy"><h3>'+escapeHtml(prompt)+'</h3><p>'+escapeHtml(formatUpdateDate(item.createdAt))+' &middot; '+Number(item.width||0)+'&times;'+Number(item.height||0)+' &middot; '+humanBytes(item.sizeBytes)+'</p><div class="studio-image-tags"><span>'+escapeHtml(item.checkpoint||'Checkpoint')+'</span><span>Seed '+escapeHtml(item.seed)+'</span></div><div class="studio-image-actions"><a class="btn ghost" href="'+escapeHtml(download)+'">Download</a><button class="danger-button" type="button" onclick="Velora.deleteStudioImage(\''+escapeHtml(item.id)+'\')">Delete</button></div></div></article>';}
function imageStudioPage(){
  var data=S.imageStudio||{};var engine=data.engine||{};var history=data.history||[];var draft=S.imageDraft||{};var ready=!!engine.ready;var checkpoints=engine.checkpoints||[];
  if(!draft.checkpoint&&checkpoints.length)draft.checkpoint=checkpoints[0];
  var statusClass=ready?'ready':'not-ready';
  return '<div class="section-head"><div><p class="eyebrow">VeloraOS Studio V2</p><h2>Image Studio</h2><p class="lead">Generate and manage private images through a ComfyUI engine running on your VeloraOS system.</p></div><button class="back" onclick="Velora.go(\'home\')">Back</button></div>'+
    '<section class="studio-status '+statusClass+'" aria-label="Image engine status"><div><span class="studio-status-dot" aria-hidden="true"></span><div><b>'+escapeHtml(engine.engine||'ComfyUI')+(ready?' ready':' unavailable')+'</b><p>'+escapeHtml(engine.message||'Checking the local image engine...')+'</p></div></div><div class="studio-status-actions"><span class="tag">'+escapeHtml(data.acceleration||status())+'</span><button class="btn ghost" type="button" onclick="Velora.refreshImageStudio()" '+(S.imageBusy?'disabled':'')+'>Refresh</button></div></section>'+
    (S.imageError?'<div class="studio-error" role="alert">'+escapeHtml(S.imageError)+'</div>':'')+
    '<div class="studio-layout"><section class="panel studio-create" aria-labelledby="studio-create-title"><div class="studio-panel-head"><div><p class="eyebrow">Text to image</p><h3 id="studio-create-title">Create an image</h3></div><span class="tag">'+escapeHtml(engine.workflow||'Standard txt2img')+'</span></div>'+
    '<div class="field"><label for="studio-prompt">Prompt</label><textarea id="studio-prompt" rows="5" maxlength="4000" placeholder="Describe the image you want to create&hellip;">'+escapeHtml(draft.prompt||'')+'</textarea></div>'+
    '<div class="field"><label for="studio-negative">Negative prompt</label><textarea id="studio-negative" rows="2" maxlength="2000" placeholder="Things to avoid, such as blur or text&hellip;">'+escapeHtml(draft.negativePrompt||'')+'</textarea></div>'+
    '<div class="studio-fields"><div class="field"><label for="studio-checkpoint">Checkpoint</label><select id="studio-checkpoint" '+(ready?'':'disabled')+'>'+(checkpoints.length?optionList(checkpoints,draft.checkpoint):'<option>No checkpoint detected</option>')+'</select></div><div class="field"><label for="studio-size">Image size</label><select id="studio-size">'+optionList(['512x512','768x768','1024x1024','768x1024','1024x768'],draft.size||'768x768')+'</select></div><div class="field"><label for="studio-steps">Steps</label><input id="studio-steps" type="number" min="1" max="60" value="'+Number(draft.steps||28)+'"></div><div class="field"><label for="studio-cfg">Guidance scale</label><input id="studio-cfg" type="number" min="1" max="20" step="0.5" value="'+Number(draft.cfg||7)+'"></div><div class="field"><label for="studio-sampler">Sampler</label><select id="studio-sampler">'+optionList(['euler','euler_ancestral','heun','dpmpp_2m','dpmpp_2m_sde'],draft.sampler||'euler')+'</select></div><div class="field"><label for="studio-scheduler">Scheduler</label><select id="studio-scheduler">'+optionList(['normal','karras','exponential','sgm_uniform','simple'],draft.scheduler||'normal')+'</select></div><div class="field studio-seed"><label for="studio-seed">Seed</label><input id="studio-seed" type="number" min="-1" placeholder="Random" value="'+escapeHtml(draft.seed==null?'':draft.seed)+'"><small>Leave blank or use -1 for a random seed.</small></div></div>'+
    '<button id="studio-generate" class="btn studio-generate" type="button" onclick="Velora.generateStudioImage()" '+(!ready||S.imageBusy?'disabled':'')+'>'+(S.imageBusy?'Generating locally&hellip;':'Generate image')+'</button><p class="small muted">Images stay on this VeloraOS system. Generation speed depends on the selected checkpoint and GPU.</p></section>'+
    '<aside class="panel studio-engine"><p class="eyebrow">Engine</p><h3>Local generation</h3><div class="studio-engine-facts"><div><small>Runtime</small><b>'+escapeHtml(engine.engine||'ComfyUI')+'</b></div><div><small>Checkpoints</small><b>'+Number(checkpoints.length)+'</b></div><div><small>Devices</small><b>'+Number(engine.deviceCount||0)+'</b></div><div><small>Endpoint</small><b>'+escapeHtml(engine.url||'Local')+'</b></div></div>'+(ready?'<p class="muted">The standard VeloraOS workflow uses your chosen checkpoint, sampler, scheduler, size, steps and seed.</p>':'<div class="studio-help"><b>To enable Image Studio</b><ol><li>Install and start ComfyUI.</li><li>Add at least one checkpoint.</li><li>Keep it available on port 8188, or set <code>VELORAOS_COMFYUI_URL</code>.</li></ol><button class="btn ghost" onclick="Velora.go(\'diagnostics\')">Open diagnostics</button></div>')+'</aside></div>'+
    '<section class="studio-history" aria-labelledby="studio-history-title"><div class="studio-history-head"><div><p class="eyebrow">Private gallery</p><h2 id="studio-history-title">Generation history</h2></div><span class="tag">'+history.length+' saved</span></div>'+(history.length?'<div class="studio-gallery">'+history.map(imageHistoryCard).join('')+'</div>':'<div class="studio-empty"><div aria-hidden="true">'+icons.image+'</div><h3>No generated images yet</h3><p>Your per-user Image Studio history will appear here.</p></div>')+'</section>';
}
async function loadImageStudio(){S.imageError='';try{S.imageStudio=await API.get('/api/image-studio/status');var checkpoints=(S.imageStudio.engine&&S.imageStudio.engine.checkpoints)||[];if(!S.imageDraft.checkpoint&&checkpoints.length)S.imageDraft.checkpoint=checkpoints[0];}catch(error){if(error.status===401){showLogin('Your session expired.');return;}S.imageStudio={engine:{ready:false,engine:'ComfyUI',message:humanError(error),checkpoints:[]},history:[]};S.imageError=humanError(error);}}
async function refreshImageStudio(){if(S.imageBusy)return;S.imageBusy=true;S.imageError='';render();await loadImageStudio();S.imageBusy=false;render();announce((S.imageStudio.engine&&S.imageStudio.engine.ready)?'Image Studio engine ready.':'Image Studio engine unavailable.');}
function studioFormPayload(){var size=String(($('#studio-size')||{}).value||'768x768').split('x');return {prompt:String(($('#studio-prompt')||{}).value||'').trim(),negativePrompt:String(($('#studio-negative')||{}).value||'').trim(),checkpoint:String(($('#studio-checkpoint')||{}).value||''),width:Number(size[0]||768),height:Number(size[1]||768),size:size.join('x'),steps:Number(($('#studio-steps')||{}).value||28),cfg:Number(($('#studio-cfg')||{}).value||7),sampler:String(($('#studio-sampler')||{}).value||'euler'),scheduler:String(($('#studio-scheduler')||{}).value||'normal'),seed:String(($('#studio-seed')||{}).value||'').trim()};}
async function generateStudioImage(){if(S.imageBusy)return;var body=studioFormPayload();if(!body.prompt){S.imageError='Enter an image prompt.';render();focusAfterRender('#studio-prompt');return;}S.imageDraft=Object.assign({},body);body.seed=body.seed===''?null:Number(body.seed);delete body.size;S.imageBusy=true;S.imageError='';render();announce('Image generation started.');try{var result=await API.post('/api/image-studio/generate',body);if(!S.imageStudio)S.imageStudio={engine:{},history:[]};S.imageStudio.history=[result.image].concat((S.imageStudio.history||[]).filter(function(item){return item.id!==result.image.id;}));S.imageDraft.seed='';announce('Image generated and added to your private gallery.');}catch(error){if(error.status===401){showLogin('Your session expired.');return;}S.imageError=humanError(error);announce('Image generation failed. '+S.imageError);}finally{S.imageBusy=false;render();focusAfterRender(S.imageError?'#studio-prompt':'#studio-history-title');}}
async function deleteStudioImage(id){if(S.imageBusy||!confirm('Delete this generated image? This cannot be undone.'))return;S.imageBusy=true;S.imageError='';try{await API.del('/api/image-studio/images/'+encodeURIComponent(id));if(S.imageStudio)S.imageStudio.history=(S.imageStudio.history||[]).filter(function(item){return item.id!==id;});announce('Generated image deleted.');}catch(error){S.imageError=humanError(error);announce('Could not delete the image. '+S.imageError);}finally{S.imageBusy=false;render();}}

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
  return {active:'Active',trial:'Trial',expired:'Expired',inactive:'Inactive',revoked:'Revoked',device_mismatch:'Device mismatch',device_limit:'Device limit reached',invalid:'Invalid key',offline:'Offline',offline_grace:'Offline grace',error:'Service error',unconfigured:'Not configured'}[state]||state;
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
  var details='<div class="license-summary"><div><span class="license-status '+escapeHtml(state)+'">'+escapeHtml(statusText)+'</span><h3>'+escapeHtml(plan)+'</h3><p class="muted">'+escapeHtml(message)+'</p>'+(l.actionRequired?'<p class="license-next-step"><b>Next step:</b> '+escapeHtml(l.actionRequired)+'</p>':'')+'</div><div class="license-orb" aria-hidden="true">✦</div></div>'+
    '<dl class="license-details"><div><dt>Licence</dt><dd>'+escapeHtml(l.maskedKey||'Not configured')+'</dd></div><div><dt>Device</dt><dd>'+escapeHtml(l.deviceName||'Not configured')+'</dd></div><div><dt>Device limit</dt><dd>'+escapeHtml(l.deviceLimit==null?'Not supplied':l.deviceLimit)+'</dd></div><div><dt>Expiry / renewal</dt><dd>'+escapeHtml(l.expiresAt?licenseDate(l.expiresAt):'No expiry supplied')+'</dd></div><div><dt>Last successful check</dt><dd>'+escapeHtml(l.lastCheckedAt?licenseDate(l.lastCheckedAt):'Never')+'</dd></div><div><dt>Last attempt</dt><dd>'+escapeHtml(l.lastAttemptAt?licenseDate(l.lastAttemptAt):'Never')+'</dd></div><div><dt>Connection</dt><dd>'+escapeHtml(l.connectionState||'unknown')+'</dd></div>'+(l.graceExpiresAt?'<div><dt>Offline grace expires</dt><dd>'+escapeHtml(licenseDate(l.graceExpiresAt))+'</dd></div>':'')+'</dl>';
  var actions='<a class="btn ghost license-account-link" href="https://www.veloraos.co.uk/account" target="_blank" rel="noopener noreferrer">Manage devices online</a>';
  if(admin){
    actions+='<div class="license-entry"><div class="field"><label for="license-key-input">Licence key</label><div class="license-key-row"><input id="license-key-input" '+(S.showLicenseKey?'type="text"':'type="password"')+' autocomplete="off" spellcheck="false" placeholder="VLOS-XXXX-XXXX-XXXX-XXXX-XXXX" aria-describedby="license-help"><button class="btn ghost" type="button" onclick="Velora.toggleLicenseKey()" aria-label="'+(S.showLicenseKey?'Hide':'Show')+' licence key">'+(S.showLicenseKey?'Hide':'Show')+'</button></div><p id="license-help" class="small muted">The full key is sent only to the local privileged backend and is never returned after activation.</p></div><div class="field"><label for="license-device-name">Device name</label><input id="license-device-name" value="'+escapeHtml(l.deviceName||((S.user&&S.user.display_name)||'VeloraOS')+'\'s VeloraOS')+'" maxlength="120"></div></div>';
    actions+='<div class="license-actions"><button class="btn" '+(S.licenseBusy?'disabled':'')+' onclick="Velora.activateLicense()">'+(l.configured?'Change licence':'Activate')+'</button>';
    if(l.configured)actions+='<button class="btn ghost" '+(S.licenseBusy?'disabled':'')+' onclick="Velora.recheckLicense()">Retry check</button><button class="danger-button" '+(S.licenseBusy?'disabled':'')+' onclick="Velora.deactivateLicense()">Deactivate this device</button>';
    actions+='</div><p class="small" id="license-action-status" role="status" aria-live="polite"></p>';
  }
  return '<section class="setting-card licensing-card" aria-labelledby="licensing-title"><div class="account-manager-head"><div><p class="eyebrow">Entitlement</p><h3 id="licensing-title">Licensing</h3></div><span class="tag">Secure local service</span></div>'+details+actions+'</section>';
}
function licenseError(error){var data=error&&error.data&&error.data.detail?error.data.detail:(error&&error.data)||{};var code=data.code||data.error;return {invalid_license:'That licence key format is not valid.',license_inactive:'This licence is inactive.',license_expired:'This licence has expired. Renew it online, then retry.',license_revoked:'This licence has been revoked. Contact VeloraOS support.',device_mismatch:'This activation belongs to a different device identity.',activation_not_found:'This device activation no longer exists. Activate it again.',activation_limit_reached:'This licence has reached its device limit. Deactivate another device from your VeloraOS account.',rate_limited:'Too many attempts. Wait a minute and try again.',network_failure:'VeloraOS could not contact the licensing service. Check your connection and retry.',server_unavailable:'The licensing service is temporarily unavailable. Retry shortly.',malformed_response:'The licensing service returned an unexpected response. Retry shortly.',not_configured:'No licence is configured on this installation.'}[code]||humanError(error);}
function toggleLicenseKey(){S.showLicenseKey=!S.showLicenseKey;render();var input=$('#license-key-input');if(input)input.focus();}
async function activateLicense(){
  var keyInput=$('#license-key-input');var key=((keyInput||{}).value||'').toUpperCase().replace(/\s+/g,'');var name=(($('#license-device-name')||{}).value||'').trim();
  if(S.license&&S.license.configured&&!key&&!confirm('Retry the currently stored licence on this device?'))return;
  if(S.license&&S.license.configured&&key&&!confirm('Changing the licence will replace the stored key after the new licence activates successfully. Continue?'))return;
  if(keyInput)keyInput.value='';
  S.licenseBusy=true;setStatus('license-action-status','Contacting the licensing service…',false);
  try{S.license=await API.post('/api/license/activate',{licenseKey:key||null,deviceName:name||null});setStatus('license-action-status','Licence activated successfully.',false);S.showLicenseKey=false;render();}
  catch(error){setStatus('license-action-status',licenseError(error),true);}finally{key='';S.licenseBusy=false;}
}
async function recheckLicense(){S.licenseBusy=true;setStatus('license-action-status','Checking entitlement…',false);try{S.license=await API.post('/api/license/recheck',{});setStatus('license-action-status','Entitlement refreshed.',false);render();}catch(error){setStatus('license-action-status',licenseError(error),true);}finally{S.licenseBusy=false;}}
async function deactivateLicense(){if(!confirm('Deactivate this VeloraOS device? It will stop using a device slot, and this installation will require activation again.'))return;S.licenseBusy=true;setStatus('license-action-status','Deactivating device…',false);try{S.license=await API.post('/api/license/deactivate',{});setStatus('license-action-status','This device has been deactivated.',false);render();}catch(error){setStatus('license-action-status',licenseError(error),true);}finally{S.licenseBusy=false;}}

function humanBytes(value){var bytes=Number(value||0);if(!bytes)return '0 B';var units=['B','KB','MB','GB'];var index=Math.min(units.length-1,Math.floor(Math.log(bytes)/Math.log(1024)));return (bytes/Math.pow(1024,index)).toFixed(index?1:0)+' '+units[index];}
async function loadRecovery(){
  if(!S.user||S.user.role!=='admin'){S.backups=[];S.recovery=null;return;}
  try{var backupData=await API.get('/api/backups');S.backups=backupData.backups||[];}catch(error){if(error.status===401)throw error;S.backups=[];S.recoveryNotice=humanError(error);}
  try{S.recovery=await API.get('/api/recovery/status');}catch(error){if(error.status===401)throw error;S.recovery={};S.recoveryNotice=humanError(error);}
}
function recoverySetNotice(text,isError){S.recoveryNotice=text||'';render();setStatus('recovery-status',S.recoveryNotice,!!isError);}
async function createBackup(){
  if(S.recoveryBusy)return;S.recoveryBusy=true;recoverySetNotice('Creating protected backup…',false);
  try{var result=await API.post('/api/backups',{});await loadRecovery();S.recoveryNotice='Backup '+result.backup.filename+' created and verified.';}
  catch(error){S.recoveryNotice=humanError(error);}finally{S.recoveryBusy=false;render();}
}
async function importBackup(files){
  var file=files&&files[0];if(!file||S.recoveryBusy)return;
  if(file.size>96*1024*1024){recoverySetNotice('Backup files must be 96 MB or smaller.',true);return;}
  S.recoveryBusy=true;recoverySetNotice('Verifying and importing '+file.name+'…',false);
  try{var result=await API.upload('/api/backups/import',file);await loadRecovery();S.recoveryNotice='Imported and verified '+result.backup.filename+'.';}
  catch(error){S.recoveryNotice=humanError(error);}finally{S.recoveryBusy=false;render();}
}
function downloadBackup(id){window.location.href='/api/backups/'+encodeURIComponent(id)+'/download';}
async function restoreBackup(id){
  var confirmation=prompt('This replaces accounts, chats, settings, avatars and personalisation. A pre-restore snapshot will be created and all sessions will be signed out.\n\nType RESTORE to continue.');
  if(String(confirmation||'').trim().toUpperCase()!=='RESTORE')return;
  S.recoveryBusy=true;recoverySetNotice('Verifying backup and creating the pre-restore snapshot…',false);
  try{var result=await API.post('/api/backups/'+encodeURIComponent(id)+'/restore',{confirmation:'RESTORE'});S.user=null;S.csrf='';showLogin(result.message+' Sign in with an administrator account from the restored backup.');}
  catch(error){S.recoveryBusy=false;recoverySetNotice(humanError(error),true);}
}
async function deleteBackup(id){
  if(!confirm('Delete this stored backup? Download it first if you may need it later.'))return;
  S.recoveryBusy=true;
  try{await API.del('/api/backups/'+encodeURIComponent(id));await loadRecovery();S.recoveryNotice='Backup deleted.';}
  catch(error){S.recoveryNotice=humanError(error);}finally{S.recoveryBusy=false;render();}
}
async function restartRecoveryService(target){
  var label=target==='veloraos'?'VeloraOS Web UI':'Ollama';if(!confirm('Restart '+label+' now?'))return;
  S.recoveryBusy=true;recoverySetNotice('Restarting '+label+'…',false);
  try{var result=await API.post('/api/recovery/restart',{target:target});S.recoveryNotice=result.message||label+' restart requested.';if(target==='veloraos'){render();setTimeout(function(){window.location.href='/app?restarted='+Date.now();},3500);return;}await loadRecovery();}
  catch(error){S.recoveryNotice=humanError(error);}finally{S.recoveryBusy=false;render();}
}
async function repairRecoveryPermissions(){
  if(!confirm('Repair VeloraOS application, data and protected-state permissions?'))return;
  S.recoveryBusy=true;recoverySetNotice('Repairing permissions…',false);
  try{var result=await API.post('/api/recovery/repair-permissions',{});await loadRecovery();S.recoveryNotice=result.message||'Permissions repaired.';}
  catch(error){S.recoveryNotice=humanError(error);}finally{S.recoveryBusy=false;render();}
}
async function clearRecoveryDownloads(){
  S.recoveryBusy=true;recoverySetNotice('Clearing failed download records…',false);
  try{var result=await API.post('/api/recovery/clear-failed-downloads',{});await loadRecovery();S.recoveryNotice=result.message+' '+result.clearedTasks+' task record(s) removed.';}
  catch(error){S.recoveryNotice=humanError(error);}finally{S.recoveryBusy=false;render();}
}
async function recoveryRecheckLicence(){
  S.recoveryBusy=true;recoverySetNotice('Rechecking licence entitlement…',false);
  try{S.license=await API.post('/api/license/recheck',{});S.recoveryNotice='Licence entitlement refreshed: '+licenseStateLabel(S.license.status)+'.';}
  catch(error){S.recoveryNotice=licenseError(error);}finally{S.recoveryBusy=false;render();}
}
async function generateRecoveryDiagnostics(){
  S.recoveryBusy=true;recoverySetNotice('Collecting and sanitising diagnostics…',false);
  try{var result=await API.post('/api/recovery/diagnostics',{});S.diagnosticsArchive=result.diagnostics;S.recoveryNotice='Sanitised diagnostics ZIP is ready.';render();window.location.href=result.diagnostics.downloadUrl;}
  catch(error){S.recoveryNotice=humanError(error);}finally{S.recoveryBusy=false;render();}
}
function serviceRecoveryCard(name,label){
  var service=((S.recovery||{}).services||{})[name]||{};var ready=!!service.ready;
  return '<div class="recovery-tool"><div><span class="diagnostic-badge '+(ready?'ready':'not-ready')+'">'+escapeHtml(service.state||'unknown')+'</span><h3>'+escapeHtml(label)+'</h3><p class="muted">'+escapeHtml(service.unit||label)+' · '+(service.installed===false?'not installed':'managed by systemd')+'</p></div><button class="btn ghost" '+(S.recoveryBusy?'disabled':'')+' onclick="Velora.restartRecoveryService(\''+name+'\')">Restart</button></div>';
}
function backupRow(item){
  var counts=item.counts||{};var invalid=!item.valid;
  return '<article class="backup-row '+(invalid?'invalid':'')+'"><div class="backup-main"><div><span class="tag '+(invalid?'warn':'')+'">'+(invalid?'Integrity failed':escapeHtml(item.reason||'manual'))+'</span><h3>'+escapeHtml(item.filename||item.id)+'</h3><p class="muted">'+escapeHtml(formatUpdateDate(item.createdAt))+' · VeloraOS '+escapeHtml(item.sourceVersion||'Unknown')+' · '+humanBytes(item.sizeBytes)+'</p>'+(invalid?'<p class="error-text">'+escapeHtml(item.error||'This backup is invalid.')+'</p>':'<div class="backup-counts"><span>'+Number(counts.accounts||0)+' accounts</span><span>'+Number(counts.chats||0)+' chats</span><span>'+Number(counts.avatars||0)+' avatars</span><span>'+Number(counts.models||0)+' model tags</span></div>')+'</div></div><div class="backup-actions"><button class="btn ghost" '+(invalid?'disabled':'')+' onclick="Velora.downloadBackup(\''+escapeHtml(item.id)+'\')">Download</button><button class="btn" '+(invalid||S.recoveryBusy?'disabled':'')+' onclick="Velora.restoreBackup(\''+escapeHtml(item.id)+'\')">Restore</button><button class="danger-button" '+(S.recoveryBusy?'disabled':'')+' onclick="Velora.deleteBackup(\''+escapeHtml(item.id)+'\')">Delete</button></div></article>';
}
function recoveryPage(embedded){
  var recovery=S.recovery||{};var backups=S.backups||[];var restored=recovery.restoredModelList||{};var restoredModels=Array.isArray(restored.models)?restored.models:[];
  return (embedded?'<div class="system-info-section-head"><div><p class="eyebrow">Protection and support</p><h2>Backup & Recovery</h2><p class="lead">Verified backups, restoration and administrator repair tools.</p></div></div>':'<div class="section-head"><div><p class="eyebrow">Protection and support</p><h2>Backup & Recovery</h2><p class="lead">Verified backups, safe restoration and administrator recovery tools for VeloraOS.</p></div><button class="back" onclick="Velora.go(\'home\')">Back</button></div>')+
    '<p id="recovery-status" class="recovery-notice '+(S.recoveryNotice?'show':'')+'" role="status" aria-live="polite">'+escapeHtml(S.recoveryNotice||'')+'</p>'+
    '<section class="panel recovery-panel"><div class="recovery-head"><div><p class="eyebrow">Build 4</p><h3>Backup & Restore</h3><p class="muted">Backups contain accounts, password hashes, chats, settings, avatars, personalisation and an installed-model list. Licence keys and device identity are deliberately excluded.</p></div><div class="recovery-actions"><button class="btn" '+(S.recoveryBusy?'disabled':'')+' onclick="Velora.createBackup()">Create backup</button><label class="btn ghost upload-button">Import backup<input type="file" accept=".vbackup,.zip,application/zip" onchange="Velora.importBackup(this.files)" '+(S.recoveryBusy?'disabled':'')+'></label></div></div><div class="backup-security"><b>Secure restoration</b><span>Every archive is size-limited, path-safe and SHA-256 verified. Restore creates a pre-restore backup, stages all data, swaps it atomically and signs out every session.</span></div><div class="backup-list">'+(backups.length?backups.map(backupRow).join(''):'<div class="diagnostic-empty">No backups yet. Create one before testing destructive changes.</div>')+'</div></section>'+
    '<section class="panel recovery-panel"><div class="recovery-head"><div><p class="eyebrow">Build 5</p><h3>Recovery & Support Tools</h3><p class="muted">Focused repairs only. These tools never delete Ollama models, licensing identity or user data.</p></div><span class="tag">Administrator only</span></div><div class="recovery-tools">'+serviceRecoveryCard('veloraos','VeloraOS Web UI')+serviceRecoveryCard('ollama','Ollama')+'<div class="recovery-tool"><div><span class="tag">Permissions</span><h3>Repair permissions</h3><p class="muted">Restore secure modes for application, account data, backups and protected state.</p></div><button class="btn ghost" '+(S.recoveryBusy?'disabled':'')+' onclick="Velora.repairRecoveryPermissions()">Repair</button></div><div class="recovery-tool"><div><span class="tag">Downloads</span><h3>Clear failed downloads</h3><p class="muted">'+Number(recovery.failedDownloads||0)+' failed task record(s). Installed models are untouched.</p></div><button class="btn ghost" '+(S.recoveryBusy?'disabled':'')+' onclick="Velora.clearRecoveryDownloads()">Clear</button></div><div class="recovery-tool"><div><span class="tag">Licensing</span><h3>Recheck licence</h3><p class="muted">Refresh entitlement without exposing the stored licence key.</p></div><button class="btn ghost" '+(S.recoveryBusy?'disabled':'')+' onclick="Velora.recoveryRecheckLicence()">Recheck</button></div><div class="recovery-tool"><div><span class="tag">Support</span><h3>Sanitised diagnostics ZIP</h3><p class="muted">Collect hardware, runtime, service and redacted log information without chats or account data.</p></div><button class="btn" '+(S.recoveryBusy?'disabled':'')+' onclick="Velora.generateRecoveryDiagnostics()">Generate ZIP</button></div></div>'+(restoredModels.length?'<div class="restored-models"><b>Model list from last restore</b><p class="muted">Model files are never packed into backups. Reinstall missing models from Models when required.</p><code>'+escapeHtml(restoredModels.join('\n'))+'</code></div>':'')+'</section>';
}
function systemHealthOverview(){var sys=S.system||{};var d=S.diagnostics||{};var o=d.ollama||{};var l=S.license||{};var installed=allModels().filter(function(model){return model.availability&&model.availability.installed;}).length;var gpu=(sys.gpu||{});var health=(o.ready!==false&&l.activated!==false)?'Healthy':'Needs attention';return '<section class="system-overview panel"><div class="system-overview-head"><div><p class="eyebrow">At a glance</p><h3>'+escapeHtml(health)+'</h3></div><span class="diagnostic-badge '+(health==='Healthy'?'ready':'not-ready')+'">'+escapeHtml(health)+'</span></div><div class="system-overview-grid">'+diagnosticFact('VeloraOS',sys.version||'1.10.28')+diagnosticFact('CPU',(sys.cpu||{}).model)+diagnosticFact('Memory',(sys.memory||{}).total)+diagnosticFact('Free disk',(sys.storage||{}).free)+diagnosticFact('GPU',(gpu.name||gpu.vendor||'CPU only'),sys.acceleration||'CPU only')+diagnosticFact('Ollama',o.ready?'Running':'Needs attention',o.version||o.serviceState)+diagnosticFact('Installed models',String(installed))+diagnosticFact('Licence',licenseStateLabel(l.status),l.planName||'')+'</div></section>';}
function secureMobileAccessCard(){
  var status=S.mobileSecurity||{};
  var browserTrusted=location.protocol==='https:'&&window.isSecureContext;
  var httpsText=status.httpsActive?'Active':'Needs attention';
  var certText=browserTrusted?'Trusted locally':(status.certificateReady?'Installed · trust this CA on this device':'Not ready');
  var caText=status.caReady?'Ready':'Not ready';
  var expiry=status.expiresAt?'<span>Certificate expires: '+escapeHtml(status.expiresAt)+'</span>':'';
  var fingerprint=status.fingerprint?'<code>'+escapeHtml(status.fingerprint)+'</code>':'';
  return '<section class="panel secure-mobile-card" id="secure-mobile-access"><div class="secure-mobile-head"><div><p class="eyebrow">Secure mobile access</p><h3>HTTPS & device trust</h3><p class="muted">Trust the VeloraOS Local CA once on each phone or computer to remove certificate warnings and enable a trusted PWA secure context.</p></div><span class="diagnostic-badge '+(browserTrusted?'ready':'not-ready')+'">'+(browserTrusted?'Trusted':'Needs trust')+'</span></div>'+
    '<div class="secure-mobile-status">'+
      diagnosticFact('HTTPS',httpsText)+
      diagnosticFact('Certificate',certText)+
      diagnosticFact('Mobile CA',caText)+
    '</div>'+
    '<div class="secure-mobile-actions"><a class="btn" href="/veloraos-local-ca.crt" download>Download certificate</a>'+(status.hostname?'<span class="tag">'+escapeHtml(status.hostname)+'</span>':'')+'</div>'+
    '<div class="secure-mobile-cert-meta">'+expiry+fingerprint+'</div>'+
    '<div class="secure-mobile-guides">'+
      '<details><summary>iPhone / iPad</summary><ol><li>Download the VeloraOS CA certificate.</li><li>Open Settings and install the downloaded profile.</li><li>Go to Settings → General → About → Certificate Trust Settings.</li><li>Enable full trust for the VeloraOS Local CA.</li><li>Return to VeloraOS in Safari, then use Share → Add to Home Screen.</li></ol></details>'+
      '<details><summary>Android</summary><ol><li>Download the VeloraOS CA certificate.</li><li>Open Security / Encryption & credentials in Android Settings.</li><li>Choose Install a certificate → CA certificate and select the downloaded file.</li><li>Reopen VeloraOS in Chrome and use Install app / Add to Home Screen.</li></ol></details>'+
      '<details><summary>Windows</summary><ol><li>Download the VeloraOS CA certificate.</li><li>Open the certificate and choose Install Certificate.</li><li>Install it for the current user or local machine into Trusted Root Certification Authorities.</li><li>Close and reopen the browser, then load VeloraOS over HTTPS.</li></ol></details>'+
      '<details><summary>macOS</summary><ol><li>Download the VeloraOS CA certificate.</li><li>Open it in Keychain Access.</li><li>Add it to the login or System keychain.</li><li>Open the certificate, expand Trust and set When using this certificate to Always Trust.</li><li>Restart Safari/Chrome and reopen VeloraOS.</li></ol></details>'+
    '</div></section>';
}
function systemInfoPage(){
  return '<div class="section-head"><div><p class="eyebrow">System administration</p><h2>System Info</h2><p class="lead">Diagnostics, hardware health, backups and recovery tools in one place.</p></div><button class="back" onclick="Velora.go(\'home\')">Back</button></div>'+systemHealthOverview()+secureMobileAccessCard()+
    '<nav class="system-info-jump" aria-label="System Info sections"><a class="btn ghost" href="#system-diagnostics">Diagnostics</a><a class="btn ghost" href="#system-recovery">Backup & Recovery</a></nav>'+
    '<section id="system-diagnostics" class="system-info-group">'+diagnosticsPage(true)+'</section>'+
    '<section id="system-recovery" class="system-info-group">'+recoveryPage(true)+'</section>';
}
function recoverySettingsCard(){if(!S.user||S.user.role!=='admin')return '';return '<div class="setting-card"><p class="eyebrow">Protection</p><h3>Backup & Recovery</h3><p class="muted">Create verified backups, restore user data, restart services, repair permissions and generate a sanitised support ZIP.</p><button class="btn ghost" onclick="Velora.go(\'recovery\')">Open recovery tools</button></div>';}

function pwaSettingsCard(){
  var info=pwaInstallState();
  var button='';
  if(info.state==='installable')button='<button class="btn" onclick="Velora.installPwa()">Install VeloraOS</button>';
  else if(info.state==='ios')button='<button class="btn ghost" onclick="Velora.installPwa()">Add to Home Screen</button>';
  else if(info.state==='browser')button='<button class="btn ghost" onclick="Velora.installPwa()">Install guidance</button>';
  else if(info.state==='https-required')button='<a class="btn ghost" href="/veloraos-local-ca.crt" download>Download VeloraOS CA</a>';
  else button='<button class="btn ghost" disabled>Installed</button>';
  var trusted=location.protocol==='https:'&&window.isSecureContext;var security=S.mobileSecurity||{};return '<div class="setting-card pwa-setting-card"><p class="eyebrow">Mobile app</p><h3>Install VeloraOS</h3><div class="mobile-security-mini"><span>HTTPS: <b>'+(security.httpsActive?'Active':'Check required')+'</b></span><span>Certificate: <b>'+(trusted?'Trusted locally':'Trust required')+'</b></span><span>Mobile CA: <b>'+(security.caReady?'Ready':'Check required')+'</b></span></div><p class="muted">'+escapeHtml(info.message)+'</p><div class="pwa-install-actions">'+button+'<a class="btn ghost" href="/veloraos-local-ca.crt" download>Download certificate</a><button class="btn ghost" onclick="Velora.go(\'system-info\')">Trust instructions</button></div><p class="small muted">VeloraOS uses a private local certificate authority for HTTPS. Authenticated APIs, chats, settings, licence information and model data remain network-only on your appliance.</p></div>';
}
function settingsPage(){
  return '<div class="section-head"><div><p class="eyebrow">Settings</p><h2>Settings</h2><p class="lead">Profiles, separate user accounts, personalisation and system details.</p></div><button class="back" onclick="Velora.go(\'home\')">Back</button></div><div class="settings-grid">'+pwaSettingsCard()+profileCard()+personalisationCard()+machineCard()+setupSettingsCard()+recoverySettingsCard()+licensingCard()+accountsCard()+'</div>';
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
async function installUpdate(){
  S.updateModal=false;
  S.updateBusy=true;
  S.updateReconnect=false;
  S.updateInstallStartedAt=Date.now();
  announceUpdate('Starting update installation.');
  render();
  try{
    S.update=await API.post('/api/update/install',{});
    if(!S.update||!S.update.state)S.update=Object.assign({},S.update||{},{state:'installing',message:'Installing VeloraOS…'});
  }catch(error){
    if(updateTransportFailure(error)&&updateRecentlyStarted()){
      markUpdateReconnecting();
    }else{
      var safe=humanError(error);
      if(/<html|<!doctype|bad gateway/i.test(String(safe||'')))safe='The update service could not be reached.';
      S.update=Object.assign({},S.update||{},{state:'failed',error:safe,message:safe});
    }
  }finally{
    S.updateBusy=false;
    render();
    startUpdatePolling();
  }
}
function restartWebUi(){window.location.href='/app?updated='+Date.now();}
function confirmReboot(){if(!window.confirm('Reboot this VeloraOS system now to finish the update?'))return;API.post('/api/update/reboot',{}).then(function(){announceUpdate('System reboot started.');}).catch(function(error){alert(humanError(error));});}

async function loadAccounts(){
  if(!S.user||S.user.role!=='admin'){S.accounts=[];return;}
  try{var data=await API.get('/api/accounts');S.accounts=data.accounts||[];}catch(error){S.accounts=[];if(error.status===401)showLogin('Your session expired.');}
}
function setStatus(id,text,isError){var element=document.getElementById(id);if(element){element.textContent=text||'';element.classList.toggle('error-text',!!isError);element.setAttribute('role',isError?'alert':'status');element.setAttribute('aria-live',isError?'assertive':'polite');}}
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
  app.innerHTML='<div class="shell">'+accessibilityChrome()+'<main id="main-content" class="main login-main" tabindex="-1"><div class="panel login-card"><div class="brand login-brand"><div class="logo" role="img" aria-label="VeloraOS">V</div><div><h1>VeloraOS</h1><p>Sign in to your local AI appliance</p></div></div>'+(message?'<div class="login-error" role="alert">'+escapeHtml(message)+'</div>':'')+'<div class="field"><label for="login-username">Username</label><input id="login-username" value="admin" autocomplete="username"></div><div class="field"><label for="login-password">Password</label><input id="login-password" type="password" placeholder="Password" autocomplete="current-password" onkeydown="if(event.key===\'Enter\')Velora.doLogin()"></div><button class="btn login-button" id="login-button" onclick="Velora.doLogin()">Login</button><p class="muted small">Fresh installs start as <b>admin</b> / <b>veloraos</b> and immediately require a new password.</p><p class="small" id="login-status" role="status" aria-live="polite"></p></div></main></div>';
}
async function doLogin(){
  var username=($('#login-username')||{}).value||'';var password=($('#login-password')||{}).value||'';var button=$('#login-button');if(button)button.disabled=true;setStatus('login-status','Signing in...',false);
  try{var result=await API.post('/api/auth/login',{username:username,password:password});localStorage.removeItem('velora_session');await startAuthenticated(result.user,result.csrfToken);}
  catch(error){setStatus('login-status',humanError(error),true);if(button)button.disabled=false;}
}
function toggleTopMenu(event){
  if(event&&event.stopPropagation)event.stopPropagation();
  S.topMenuOpen=!S.topMenuOpen;
  render();focusAfterRender(S.topMenuOpen?'#profile-menu button':'#profile-menu-button');
}
async function logout(){
  try{await API.post('/api/auth/logout',{});}catch(_){ }
  stopUpdatePolling();stopBackgroundPolling();S.user=null;S.csrf='';S.license=null;S.update=null;S.setup=null;S.setupDeviceDraft=null;S.settings={};S.chats=[];S.msgs=[];S.active=null;S.topMenuOpen=false;showLogin('You have been signed out.');
}
async function startAuthenticated(user,csrfToken){
  S.user=user;S.csrf=csrfToken||S.csrf||'';S.pendingAvatar=null;S.setupDeviceDraft=null;S.topMenuOpen=false;
  try{
    await loadSettings();await loadLicense();if(user&&user.role==='admin')await loadSetupStatus();
    if(S.setup&&S.setup.required){await loadSetupCore();S.setupStep=S.setup.suggestedStep||1;S.page='setup';render();return;}
    await loadCore();if(user&&user.role==='admin')await loadUpdateStatus();
  }
  catch(error){if(error.status===401){showLogin('Your session expired.');return;}throw error;}
  if(!S.chats.length){var id=(window.crypto&&crypto.randomUUID)?crypto.randomUUID():String(Date.now());S.active=id;S.chats=[{id:id,title:'New chat',model:S.selected,messages:[]}];S.msgs=[];await saveChats();}
  else{var chat=S.chats[0];S.active=chat.id;S.msgs=chat.messages||[];S.selected=chat.model||S.selected;}
  await loadBackgroundTasks();S.page='home';syncActiveChatBusy();render();startUpdatePolling();startBackgroundPolling();
}
async function boot(){
  try{var result=await API.get('/api/auth/me');await startAuthenticated(result.user,result.csrfToken);}
  catch(error){if(error.status===401){showLogin();return;}fatal(humanError(error));}
}

function enhanceAccessibility(){
  var sequence=0;
  document.querySelectorAll('.field').forEach(function(field){var control=field.querySelector('input,select,textarea');var label=field.querySelector('label');if(!control||!label)return;if(!control.id)control.id='a11y-field-'+(++sequence);label.setAttribute('for',control.id);});
  document.querySelectorAll('[id$="-status"]').forEach(function(element){if(!element.hasAttribute('role'))element.setAttribute('role','status');if(!element.hasAttribute('aria-live'))element.setAttribute('aria-live','polite');});
  document.querySelectorAll('button svg,.app-icon svg,.empty-orb svg').forEach(function(svg){svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');});
  document.querySelectorAll('.progress').forEach(function(progress){if(!progress.hasAttribute('role'))progress.setAttribute('role','progressbar');if(!progress.hasAttribute('aria-label'))progress.setAttribute('aria-label','Progress');var fill=progress.querySelector('span');var value=fill&&parseFloat(fill.style.width);if(Number.isFinite(value))progress.setAttribute('aria-valuenow',String(Math.max(0,Math.min(100,value))));progress.setAttribute('aria-valuemin','0');progress.setAttribute('aria-valuemax','100');});
}
var accessibilityObserver=new MutationObserver(enhanceAccessibility);
accessibilityObserver.observe(document.getElementById('app'),{childList:true,subtree:true});
enhanceAccessibility();

window.Velora={
  go:go,installModel:installModel,createWorkspace:createWorkspace,openWorkspace:openWorkspace,openWorkspaceFile:openWorkspaceFile,saveWorkspaceFile:saveWorkspaceFile,newWorkspaceFile:newWorkspaceFile,runWorkspaceCommand:runWorkspaceCommand,workspaceGitDiff:workspaceGitDiff,workspaceGitCommit:workspaceGitCommit,uploadKnowledge:uploadKnowledge,searchKnowledge:searchKnowledge,cancelModelDownload:cancelModelDownload,deleteModel:deleteModel,refreshDiagnostics:refreshDiagnostics,runAccelerationTest:runAccelerationTest,newChat:newChat,openChat:openChat,deleteChat:deleteChat,renameChat:renameChat,exportChat:exportChat,copyMessage:copyMessage,copyCode:copyCode,beginEditMessage:beginEditMessage,cancelEditMessage:cancelEditMessage,regenerateMessage:regenerateMessage,setSearch:setSearch,toggleMobileChats:toggleMobileChats,toggleModelMenu:toggleModelMenu,selectModel:selectModel,toggleLockdownMode:toggleLockdownMode,send:send,stopGeneration:stopGeneration,toggleCosmicReasoning:toggleCosmicReasoning,previewCosmicReasoning:previewCosmicReasoning,commitCosmicReasoning:commitCosmicReasoning,
  reload:reload,logout:logout,toggleTopMenu:toggleTopMenu,doLogin:doLogin,openImagePicker:openImagePicker,handleImageFiles:handleImageFiles,removePendingImage:removePendingImage,refreshImageStudio:refreshImageStudio,generateStudioImage:generateStudioImage,deleteStudioImage:deleteStudioImage,
  selectProfilePicture:selectProfilePicture,removeProfilePicture:removeProfilePicture,saveProfile:saveProfile,savePersonalisation:savePersonalisation,resetPersonalisation:resetPersonalisation,
  createAccount:createAccount,updateAccount:updateAccount,deleteAccount:deleteAccount,toggleLicenseKey:toggleLicenseKey,activateLicense:activateLicense,recheckLicense:recheckLicense,deactivateLicense:deactivateLicense,loadRecovery:loadRecovery,createBackup:createBackup,importBackup:importBackup,downloadBackup:downloadBackup,restoreBackup:restoreBackup,deleteBackup:deleteBackup,restartRecoveryService:restartRecoveryService,repairRecoveryPermissions:repairRecoveryPermissions,clearRecoveryDownloads:clearRecoveryDownloads,recoveryRecheckLicence:recoveryRecheckLicence,generateRecoveryDiagnostics:generateRecoveryDiagnostics,loadUpdateStatus:loadUpdateStatus,checkForUpdates:checkForUpdates,openUpdateModal:openUpdateModal,closeUpdateModal:closeUpdateModal,installUpdate:installUpdate,dismissUpdateNotice:dismissUpdateNotice,markAllNotificationsRead:markAllNotificationsRead,clearNotifications:clearNotifications,openNotificationAction:openNotificationAction,restartWebUi:restartWebUi,confirmReboot:confirmReboot,setSetupStep:setSetupStep,setupBack:setupBack,setupNext:setupNext,updateSetupDeviceDraft:updateSetupDeviceDraft,changeSetupPassword:changeSetupPassword,saveSetupDeviceName:saveSetupDeviceName,checkSetupLicence:checkSetupLicence,runSetupHardware:runSetupHardware,runSetupOllama:runSetupOllama,toggleSetupModel:toggleSetupModel,installSetupModel:installSetupModel,cancelSetupDownload:cancelSetupDownload,skipSetupModel:skipSetupModel,runSetupReadiness:runSetupReadiness,finishSetup:finishSetup,enterVelora:enterVelora,startSetupWizard:startSetupWizard,cancelSetup:cancelSetup,installPwa:installPwa,render:render
};

registerPwa();
boot();
})();

window.VELORAOS_RELEASE="1.10.28";
