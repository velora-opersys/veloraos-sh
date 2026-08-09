#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(sys.argv[1]).resolve()
MAIN = ROOT / "app/main.py"
APP = ROOT / "app/static/app.js"
CSS = ROOT / "app/static/style.css"
INDEX = ROOT / "app/static/index.html"
SW = ROOT / "app/static/sw.js"


def block(text: str, start: str, end: str, replacement: str) -> str:
    a = text.find(start)
    if a < 0:
        raise RuntimeError(f"start marker not found: {start}")
    b = text.find(end, a)
    if b < 0:
        raise RuntimeError(f"end marker not found: {end}")
    return text[:a] + replacement.rstrip() + "\n\n" + text[b:]


def must_replace(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"replace marker not found for {label}")
    return text.replace(old, new)


# ---------------- Backend ----------------
main = MAIN.read_text()
main = must_replace(main, 'VERSION = "1.10.55"', 'VERSION = "1.10.56"', 'backend version')

catalog = '''CATALOG = [
    {
        "id": "veloraos-main",
        "name": "VeloraOS Main",
        "tag": "qwen2.5:3b",
        "kind": "Main assistant",
        "category": "chat",
        "download": "1.9 GB",
        "bytes": int(1.9 * 1024 * 1024 * 1024),
        "desc": "The standard VeloraOS assistant for everyday private local AI.",
        "profile": "main",
    },
    {
        "id": "llava-7b",
        "name": "VeloraOS Vision",
        "tag": "llava:7b",
        "kind": "Vision",
        "category": "vision",
        "download": "4.7 GB",
        "bytes": int(4.7 * 1024 * 1024 * 1024),
        "desc": "LLaVA 7B for private image understanding. Used automatically when an image is attached.",
    },
    {
        "id": "qwen2.5-coder-7b",
        "name": "VeloraOS Coding",
        "tag": "qwen2.5-coder:7b",
        "kind": "Coding",
        "category": "coding",
        "download": "4.7 GB",
        "bytes": int(4.7 * 1024 * 1024 * 1024),
        "desc": "Qwen2.5 Coder 7B for code generation, debugging and development.",
    },
]'''
main = block(main, 'CATALOG = [', '\n\nTASKS:', catalog)

# Request type for the advanced custom-model endpoints.
if 'class CustomModelReq(BaseModel):' not in main:
    marker = 'class DiagnosticsTestReq(BaseModel):'
    pos = main.find(marker)
    if pos < 0:
        raise RuntimeError('DiagnosticsTestReq marker not found')
    custom_req = '''class CustomModelReq(BaseModel):
    tag: str


'''
    main = main[:pos] + custom_req + main[pos:]

# Core model + advanced custom-model helpers.
helper = r'''CUSTOM_MODEL_TAG_RE = re.compile(
    r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}(?::[A-Za-z0-9][A-Za-z0-9._-]{0,63})?$"
)


def official_model_tags() -> List[str]:
    return [str(model.get("tag") or "") for model in CATALOG if str(model.get("tag") or "")]


def validate_custom_model_tag(value: Any) -> str:
    tag = str(value or "").strip()
    if not tag or len(tag) > 192 or not CUSTOM_MODEL_TAG_RE.fullmatch(tag):
        raise HTTPException(
            400,
            "Enter a valid Ollama model tag such as llama3.2:3b. URLs, whitespace and shell characters are not allowed.",
        )
    if any(model_tag_matches(tag, official) for official in official_model_tags()):
        raise HTTPException(400, "That is a VeloraOS core model. Use its normal Models card instead.")
    return tag


def custom_model_record(tag: str) -> Dict[str, Any]:
    clean = validate_custom_model_tag(tag)
    return {
        "id": f"custom:{clean}",
        "name": clean,
        "tag": clean,
        "kind": "Advanced custom model",
        "category": "custom",
        "download": "Ollama managed",
        "bytes": 0,
        "desc": "Advanced Ollama model installed by a VeloraOS user.",
    }


def custom_installed_models() -> List[Dict[str, Any]]:
    official = official_model_tags()
    result: List[Dict[str, Any]] = []
    for installed in installed_tags():
        if any(model_tag_matches(installed, expected) for expected in official):
            continue
        tag = str(installed).strip()
        if not tag:
            continue
        result.append({
            "id": f"custom:{tag}",
            "name": tag,
            "tag": tag,
            "kind": "Advanced custom model",
            "category": "custom",
            "installed": True,
        })
    result.sort(key=lambda item: str(item.get("tag") or "").lower())
    return result


def resolve_custom_profile(requested_id: str) -> tuple[Dict[str, Any], str]:
    raw = str(requested_id or "")
    tag = validate_custom_model_tag(raw.split(":", 1)[1] if raw.startswith("custom:") else raw)
    installed = next((item for item in installed_tags() if model_tag_matches(item, tag)), None)
    if not installed:
        raise HTTPException(400, f"Custom model {tag} is not installed. Download it from Models > Advanced first.")
    actual = str(installed)
    return ({
        "id": f"custom:{actual}",
        "name": f"Custom · {actual}",
        "tag": actual,
        "reasoning_power": 2,
        "instruction": (
            "You are an advanced custom Ollama model deliberately selected by the user inside VeloraOS. "
            "Follow the user's request while respecting VeloraOS privacy and safety rules. "
            "Return only the final user-facing answer and never expose hidden reasoning or internal self-talk."
        ),
    }, f"Advanced custom model · {actual}")
'''
insert = '\n\ndef profile() -> Dict[str, Any]:'
if insert not in main:
    raise RuntimeError('profile insertion point not found')
main = main.replace(insert, '\n\n' + helper.rstrip() + insert, 1)

coding_tiers = '''CODING_MODEL_TIERS: List[Dict[str, Any]] = [
    {"id": "qwen2.5-coder-7b", "min_ram_gb": 0, "gpu_preferred": False},
]'''
main = block(main, 'CODING_MODEL_TIERS: List[Dict[str, Any]] = [', '\n\n\ndef coding_hardware_summary', coding_tiers)

recommend_coding = '''def recommend_coding_model(prof: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    prof = prof or profile()
    model = find_model("qwen2.5-coder-7b")
    hw = coding_hardware_summary(prof)
    free = int((prof.get("storage") or {}).get("free_bytes") or 0)
    required = int(model.get("bytes") or 0) + 900 * 1024**2
    result = dict(model)
    result["hardwareFit"] = True
    if free < required:
        result["reason"] = "VeloraOS Coding is the supported coding model; additional free storage is required to install it."
    elif hw["gpuReady"]:
        result["reason"] = f"VeloraOS Coding · Qwen2.5 Coder 7B with {hw['gpuVendor']} acceleration."
    else:
        result["reason"] = "VeloraOS Coding · Qwen2.5 Coder 7B. CPU execution is available but may be slower."
    result["hardware"] = hw
    return result'''
main = block(main, 'def recommend_coding_model(', '\n\n\ndef installed_coding_candidates', recommend_coding)

# Main is now intentionally one supported runtime, not a migration chain.
profile_candidates = '''def profile_tag_candidates(profile_id: str, profile: Dict[str, Any]) -> List[str]:
    if profile_id == "veloraos-main":
        return ["qwen2.5:3b"]
    return [str(profile.get("tag") or "")]'''
main = block(main, 'def profile_tag_candidates(', '\n\n\ndef installed_profile_runtime_tag', profile_candidates)

# First-run setup always recommends the supported VeloraOS Main model.
recommend_setup = '''def recommend_setup_model(prof: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    prof = prof or profile()
    result = dict(find_model("veloraos-main"))
    result["availability"] = availability(result, prof)
    result["reason"] = "VeloraOS Main · Qwen2.5 3B is the standard local assistant for every VeloraOS installation."
    return result'''
main = block(main, 'def recommend_setup_model(', '\n\n\ndef setup_model_choices', recommend_setup)

# Image turns must use the supported VeloraOS Vision runtime only.
vision_pref = '''VISION_MODEL_PREFERENCES = (
    "llava:7b",
)'''
main = block(main, 'VISION_MODEL_PREFERENCES = (', '\n\n\ndef latest_user_has_images', vision_pref)

vision_runtime = '''def installed_vision_runtime_tag() -> Optional[str]:
    tags = installed_tags()
    for installed in tags:
        if model_tag_matches(installed, "llava:7b"):
            return str(installed)
    return None'''
main = block(main, 'def installed_vision_runtime_tag()', '\n\n\nIMAGE_INTENT_ERROR', vision_runtime)
main = main.replace(
    'Install Moondream Vision or LLaVA 7B from Models, then send the image again.',
    'Install VeloraOS Vision (LLaVA 7B) from Models, then send the image again.',
)
main = main.replace('name = "LLaVA Vision"', 'name = "VeloraOS Vision"')
main = main.replace('elif "moondream" in lower:\n        name = "Moondream Vision"\n    else:\n        name = f"Local Vision · {tag}"', 'else:\n        name = "VeloraOS Vision"')

resolve_profile = '''def resolve_chat_profile(requested: Optional[str], messages: List[Dict[str, Any]]) -> tuple[Dict[str, Any], str]:
    # Image routing has priority over every manually selected text model so
    # pictures always use the supported VeloraOS Vision runtime.
    vision = vision_profile_for_messages(messages)
    if vision is not None:
        return vision

    requested_id = str(requested or "veloraos-main").strip()
    if requested_id in {"veloraos-coding", "qwen2.5-coder-7b", "qwen2.5-coder:7b"}:
        return resolve_coding_profile()
    if requested_id.startswith("custom:"):
        return resolve_custom_profile(requested_id)

    profile = dict(VELORA_CHAT_PROFILES["veloraos-main"])
    runtime_tag = installed_profile_runtime_tag("veloraos-main", profile)
    if not runtime_tag:
        raise HTTPException(400, "Install VeloraOS Main (Qwen2.5 3B) from Models before starting Chat.")
    profile["tag"] = runtime_tag
    return profile, "VeloraOS Main · Qwen2.5 3B"'''
main = block(main, 'def resolve_chat_profile(', '\n\n\ndef cosmic_reasoning_profile', resolve_profile)

# API model catalogue now exposes custom installed models separately.
needle = '"models": result,\n        "codingRecommendation": {'
if needle not in main:
    raise RuntimeError('models response marker not found')
main = main.replace(needle, '"models": result,\n        "customModels": custom_installed_models(),\n        "codingRecommendation": {', 1)

custom_api = '''@app.post("/api/custom-models/install")
def install_custom_model(req: CustomModelReq, request: Request):
    user = get_user_from_request(request, required=True)
    require_csrf(request)
    if not shutil.which("ollama"):
        raise HTTPException(400, "Ollama is not installed.")
    model = custom_model_record(req.tag)
    tag = str(model["tag"])
    task_id = str(uuid.uuid4())
    installed = next((item for item in installed_tags() if model_tag_matches(item, tag)), None)
    if installed:
        TASKS[task_id] = {
            "id": task_id, "kind": "model", "owner_id": user["id"],
            "model_id": model["id"], "model": model["name"], "tag": str(installed),
            "status": "complete", "progress": 100, "downloaded": "Installed",
            "total": "Installed", "output": f"{installed} is already installed",
            "created_at": time.time(),
        }
        return {"task_id": task_id, "status": "complete", "model": model, "already_installed": True}
    TASKS[task_id] = {
        "id": task_id, "kind": "model", "owner_id": user["id"],
        "model_id": model["id"], "model": model["name"], "tag": tag,
        "status": "queued", "progress": 0, "downloaded": "0 B",
        "total": "Ollama managed", "storage_after_install": "Unknown",
        "created_at": time.time(),
    }
    threading.Thread(target=pull_worker, args=(task_id, model), daemon=True).start()
    return {"task_id": task_id, "status": "queued", "model": model}


@app.post("/api/custom-models/remove")
def remove_custom_model(req: CustomModelReq, request: Request):
    require_admin(request)
    require_csrf(request)
    tag = validate_custom_model_tag(req.tag)
    if not shutil.which("ollama"):
        raise HTTPException(400, "Ollama is not installed.")
    with TASK_LOCK:
        active = any(
            model_tag_matches(str(record.get("tag") or ""), tag)
            and str(record.get("status") or "").lower() in {"queued", "downloading", "running"}
            for record in TASKS.values()
        )
    if active:
        raise HTTPException(409, "Wait for the active model download to finish before removing it.")
    match = next((item for item in installed_tags() if model_tag_matches(item, tag)), None)
    if not match:
        return {"status": "not_installed", "tag": tag}
    result = subprocess.run(
        ["ollama", "rm", str(match)], text=True, capture_output=True,
        timeout=300, check=False, env=ollama_environment(),
    )
    output = (result.stdout or result.stderr or "").strip()
    if result.returncode != 0:
        raise HTTPException(400, output or f"ollama rm failed with code {result.returncode}")
    return {"status": "deleted", "tag": str(match), "output": output}
'''
api_marker = '@app.get("/api/models/{model_id}")'
if api_marker not in main:
    raise RuntimeError('model detail API marker not found')
main = main.replace(api_marker, custom_api.rstrip() + '\n\n\n' + api_marker, 1)

MAIN.write_text(main)

# ---------------- Frontend ----------------
app = APP.read_text()
app = app.replace('1.10.55', '1.10.56')
# Add separate custom-model state wherever the main model payload is stored.
app = re.sub(r'models:\[\],selected:', 'models:[],customModels:[],selected:', app, count=1)
# Every model-list refresh carries the advanced list as a separate field.
app = app.replace('S.models=payload.models||payload||[];', 'S.models=payload.models||payload||[];S.customModels=payload.customModels||[];')
app = app.replace('S.models=models.models||models||[];', 'S.models=models.models||models||[];S.customModels=models.customModels||[];')
app = app.replace('catch(error){S.models=[];}', 'catch(error){S.models=[];S.customModels=[];}')
app = app.replace('catch(error){if(error.status===401)throw error;S.models=[];}', 'catch(error){if(error.status===401)throw error;S.models=[];S.customModels=[];}')

all_models = '''function allModels(includeUninstalled){
  var base=[
    {id:'veloraos-main',name:'VeloraOS Main',tag:'qwen2.5:3b',kind:'Main assistant',category:'chat',download:'1.9 GB',desc:'Everyday private local AI.'},
    {id:'llava-7b',name:'VeloraOS Vision',tag:'llava:7b',kind:'Vision',category:'vision',download:'4.7 GB',desc:'Private image understanding, used automatically for pictures.'},
    {id:'qwen2.5-coder-7b',name:'VeloraOS Coding',tag:'qwen2.5-coder:7b',kind:'Coding',category:'coding',download:'4.7 GB',desc:'Code generation, debugging and development.'}
  ];
  var allowed={"veloraos-main":true,"llava-7b":true,"qwen2.5-coder-7b":true};var byId={};base.forEach(function(model){byId[model.id]=model;});
  (S.models||[]).forEach(function(model){var id=model.id||model.tag;if(!allowed[id])return;Object.assign(byId[id],{id:id,name:model.name||byId[id].name,tag:model.tag||byId[id].tag,kind:model.kind||byId[id].kind,category:model.category||byId[id].category,download:model.download||model.size||byId[id].download,desc:model.desc||byId[id].desc,availability:model.availability||{}});});
  return includeUninstalled?base:base.filter(function(model){return !!(model.availability&&model.availability.installed);});
}'''
app = block(app, 'function allModels(includeUninstalled){', '\nfunction chatModelOptions(){', all_models)

# Brand vision copy and make Coding's single supported runtime explicit.
app = app.replace('Paste images straight into chat &middot; use Moondream/LLaVA for vision', 'Paste images straight into chat &middot; VeloraOS Vision uses LLaVA 7B automatically')
app = app.replace('Use the best installed coding model for this hardware', 'Use VeloraOS Coding · Qwen2.5 Coder 7B')

advanced_js = r'''function customModelId(tag){return 'custom:'+String(tag||'').trim();}
function customModelTag(id){return String(id||'').indexOf('custom:')===0?String(id).slice(7):'';}
function validCustomModelTag(tag){return /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,127}(?::[A-Za-z0-9][A-Za-z0-9._-]{0,63})?$/.test(String(tag||'').trim());}
function activeModelLabel(){
  if(S.codingMode)return 'Coding mode · Qwen2.5 Coder 7B';
  var custom=customModelTag(S.selected);if(custom)return 'Custom model · '+custom;
  return 'Normal chat · Qwen2.5 3B';
}
function customModelsAdvancedHtml(){
  var isAdmin=!!(S.user&&S.user.role==='admin');var selected=customModelTag(S.selected);var rows=(S.customModels||[]).map(function(item){var tag=String(item.tag||item.name||'');var active=selected===tag;return '<div class="custom-model-row '+(active?'active':'')+'"><div><b>'+escapeHtml(tag)+'</b><small>'+(active?'In use for normal text chat':'Installed in Ollama')+'</small></div><div class="custom-model-actions"><button class="btn ghost compact" data-tag="'+escapeAttribute(tag)+'" onclick="Velora.useCustomModel(this.dataset.tag)">'+(active?'Using':'Use')+'</button>'+(isAdmin?'<button class="danger-button compact" data-tag="'+escapeAttribute(tag)+'" onclick="Velora.removeCustomModel(this.dataset.tag)">Remove</button>':'')+'</div></div>';}).join('');
  var pending=Object.keys(S.modelTasks||{}).filter(function(id){return id.indexOf('custom:')===0;}).map(function(id){var task=S.modelTasks[id]||{};return '<div class="custom-model-row pending"><div><b>'+escapeHtml(customModelTag(id))+'</b><small>'+escapeHtml(task.output||task.status||'Downloading…')+'</small></div><span class="tag">'+Math.max(0,Math.min(100,Number(task.progress||0)))+'%</span></div>';}).join('');
  return '<details class="panel custom-models-advanced" '+(selected?'open':'')+'><summary><span><b>Advanced</b><small>Download and deliberately use other Ollama-compatible models.</small></span><span aria-hidden="true">›</span></summary><div class="custom-models-body"><div class="advanced-warning">Custom models are an advanced option. VeloraOS Main, Vision and Coding remain the supported defaults; images still route to VeloraOS Vision and Coding mode still routes to VeloraOS Coding.</div><div class="custom-model-download"><input id="custom-model-tag" autocomplete="off" spellcheck="false" placeholder="e.g. llama3.2:3b"><button class="btn" onclick="Velora.installCustomModel()">Download model</button></div><p id="custom-model-status" class="small muted" role="status" aria-live="polite"></p>'+(selected?'<button class="btn ghost restore-main" onclick="Velora.restoreMainModel()">Restore VeloraOS Main</button>':'')+'<div class="custom-model-list">'+pending+(rows||'<div class="custom-model-empty">No custom models installed.</div>')+'</div></div></details>';
}
async function installCustomModel(){
  var input=$('#custom-model-tag');var tag=String((input&&input.value)||'').trim();if(!validCustomModelTag(tag)){setStatus('custom-model-status','Enter a valid Ollama tag such as llama3.2:3b.',true);return;}
  try{var result=await API.post('/api/custom-models/install',{tag:tag});var id=customModelId(tag);S.modelTasks[id]={id:result.task_id,task_id:result.task_id,kind:'model',model_id:id,model:tag,tag:tag,status:result.status||'queued',progress:result.already_installed?100:0,output:result.already_installed?'Already installed':'Starting download…'};startBackgroundPolling(false);render();nativeToast(result.already_installed?tag+' is already installed.':'Downloading '+tag+' in the background.','success');}catch(error){setStatus('custom-model-status',humanError(error),true);}
}
function useCustomModel(tag){tag=String(tag||'').trim();if(!validCustomModelTag(tag))return;S.codingMode=false;S.selected=customModelId(tag);var chat=S.chats.find(function(item){return item.id===S.active;});if(chat){chat.codingMode=false;chat.model=S.selected;chat.updatedAt=new Date().toISOString();saveChats();}announce('Custom model '+tag+' selected for normal text chat.');nativeToast('Using '+tag+' for normal text chat.','success');render();}
function restoreMainModel(){S.codingMode=false;S.selected='veloraos-main';var chat=S.chats.find(function(item){return item.id===S.active;});if(chat){chat.codingMode=false;chat.model='veloraos-main';chat.updatedAt=new Date().toISOString();saveChats();}nativeToast('VeloraOS Main restored.','success');render();}
async function removeCustomModel(tag){var ok=isStandalonePwa()?await nativeConfirm({title:'Remove custom model?',message:String(tag)+' will be removed from Ollama for every VeloraOS account.',confirmLabel:'Remove',destructive:true}):window.confirm('Remove '+tag+' from Ollama?');if(!ok)return;try{await API.post('/api/custom-models/remove',{tag:tag});if(customModelTag(S.selected)===tag)restoreMainModel();await refreshModelsFromServer();render();nativeToast(tag+' removed.','success');}catch(error){nativeToast(humanError(error),'warning');}}
'''
insert_before = 'function modelsPage(){'
if insert_before not in app:
    raise RuntimeError('modelsPage insertion point missing')
app = app.replace(insert_before, advanced_js.rstrip() + '\n\n' + insert_before, 1)

models_page = '''function modelsPage(){
  var official=allModels(true).map(modelCard).join('');
  return '<div class="section-head"><div><p class="eyebrow">VeloraOS intelligence</p><h2>Models</h2><p class="lead">Three supported models power the VeloraOS experience: Main for everyday chat, Vision for pictures, and Coding for development. Install only what you need.</p></div><button class="back" onclick="Velora.go(\\'home\\')">Back</button></div><div class="core-model-intro"><span class="tag">Supported core</span><p>VeloraOS automatically routes normal chat to Qwen2.5 3B, image turns to LLaVA 7B, and Coding mode to Qwen2.5 Coder 7B.</p></div><div class="cards core-model-cards">'+official+'</div>'+customModelsAdvancedHtml();
}'''
app = block(app, 'function modelsPage(){', '\nfunction modelCard(model){', models_page)

# Preserve custom selections per conversation, while Coding remains an explicit override.
app = app.replace("function normaliseChatModelSelection(id){return String(id||'')==='veloraos-coding'?'veloraos-coding':'veloraos-main';}", "function normaliseChatModelSelection(id){var value=String(id||'');if(value==='veloraos-coding')return 'veloraos-coding';if(value.indexOf('custom:')===0&&validCustomModelTag(value.slice(7)))return value;return 'veloraos-main';}")
app = app.replace("S.selected=S.codingMode?'veloraos-coding':'veloraos-main';S.pendingImages=[]", "S.selected=S.codingMode?'veloraos-coding':normaliseChatModelSelection(chat.model);S.pendingImages=[]")
app = app.replace("S.selected=S.codingMode?'veloraos-coding':'veloraos-main';}else{S.active=null", "S.selected=S.codingMode?'veloraos-coding':normaliseChatModelSelection(next.model);}else{S.active=null")
app = app.replace("chat.model=S.codingMode?'veloraos-coding':'veloraos-main';", "chat.model=S.codingMode?'veloraos-coding':normaliseChatModelSelection(S.selected);")
app = app.replace("if(current){S.msgs=current.messages||[];S.codingMode=chatCodingMode(current);S.selected=S.codingMode?'veloraos-coding':'veloraos-main';}", "if(current){S.msgs=current.messages||[];S.codingMode=chatCodingMode(current);S.selected=S.codingMode?'veloraos-coding':normaliseChatModelSelection(current.model);}")
app = app.replace("else{var chat=S.chats[0];S.active=chat.id;S.msgs=chat.messages||[];S.codingMode=chatCodingMode(chat);S.selected=S.codingMode?'veloraos-coding':'veloraos-main';}", "else{var chat=S.chats[0];S.active=chat.id;S.msgs=chat.messages||[];S.codingMode=chatCodingMode(chat);S.selected=S.codingMode?'veloraos-coding':normaliseChatModelSelection(chat.model);}")
app = app.replace("var requestedMode=S.codingMode?'veloraos-coding':'veloraos-main';", "var requestedMode=S.codingMode?'veloraos-coding':normaliseChatModelSelection(S.selected);")
app = app.replace("function modelName(id){return String(id)==='veloraos-coding'?'VeloraOS Coding':'VeloraOS';}", "function modelName(id){var value=String(id||'');if(value==='veloraos-coding')return 'VeloraOS Coding';if(value.indexOf('custom:')===0)return value.slice(7);return 'VeloraOS Main';}")
app = app.replace("function selectModel(id){toggleCodingMode(String(id)==='veloraos-coding');}", "function selectModel(id){var value=String(id||'');if(value.indexOf('custom:')===0){useCustomModel(value.slice(7));return;}toggleCodingMode(value==='veloraos-coding');}")
app = app.replace("<small>'+escapeHtml(modeLabel)+' · Qwen2.5 3B</small>", "<small>'+escapeHtml(activeModelLabel())+'</small>")

# The supported coding card is always the official 7B coder, not a variable hardware tier.
app = app.replace("kind:(codingInstalled.length?'Best installed coder for this hardware':'Hardware-aware coding')", "kind:'Qwen2.5 Coder 7B'")

# Make the three-dot response activity explicit on mobile and give it a stable class.
app = app.replace('<span class="typing" role="status" aria-label="VeloraOS is working">', '<span class="typing velora-response-dots" role="status" aria-label="VeloraOS is working">')

# Expose advanced-model actions.
export_marker = 'go:go,installModel:installModel,'
if export_marker not in app:
    raise RuntimeError('Velora export marker missing')
app = app.replace(export_marker, 'go:go,installModel:installModel,installCustomModel:installCustomModel,useCustomModel:useCustomModel,restoreMainModel:restoreMainModel,removeCustomModel:removeCustomModel,', 1)

APP.write_text(app)

# ---------------- Styling ----------------
css = CSS.read_text().replace('1.10.55', '1.10.56')
css += r'''

/* VeloraOS 1.10.56 — core models + advanced custom models */
.core-model-intro{margin:0 0 16px;padding:14px 16px;border:1px solid rgba(120,230,225,.15);border-radius:18px;background:linear-gradient(135deg,rgba(120,230,225,.07),rgba(155,140,255,.05))}.core-model-intro p{margin:9px 0 0;color:var(--muted);line-height:1.45}.core-model-cards{margin-bottom:20px}.custom-models-advanced{margin-top:22px;padding:0;overflow:hidden}.custom-models-advanced>summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px}.custom-models-advanced>summary::-webkit-details-marker{display:none}.custom-models-advanced>summary span:first-child{display:flex;flex-direction:column;gap:4px}.custom-models-advanced>summary small{color:var(--muted);font-weight:500}.custom-models-advanced[open]>summary{border-bottom:1px solid var(--line)}.custom-models-body{padding:18px}.advanced-warning{padding:12px 14px;border-radius:14px;background:rgba(255,209,102,.07);border:1px solid rgba(255,209,102,.16);color:#e9e0c3;font-size:13px;line-height:1.45}.custom-model-download{display:flex;gap:9px;margin:14px 0 4px}.custom-model-download input{flex:1;min-width:0;border:1px solid var(--line);background:rgba(255,255,255,.055);color:var(--text);border-radius:14px;padding:12px 13px}.custom-model-list{display:grid;gap:8px;margin-top:14px}.custom-model-row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:12px 13px;border:1px solid var(--line);border-radius:14px;background:rgba(255,255,255,.03)}.custom-model-row.active{border-color:rgba(120,230,225,.3);background:rgba(120,230,225,.07)}.custom-model-row>div:first-child{min-width:0;display:flex;flex-direction:column;gap:3px}.custom-model-row b{overflow-wrap:anywhere}.custom-model-row small{color:var(--muted)}.custom-model-actions{display:flex;gap:7px;flex:0 0 auto}.custom-model-empty{padding:15px;border:1px dashed var(--line);border-radius:14px;color:var(--muted)}.restore-main{margin-top:10px}

/* VeloraOS 1.10.56 — mobile response activity: always visible while a chat task is active */
@media(max-width:720px){
  .messages .thinking-message{display:grid!important;visibility:visible!important;opacity:1!important;min-height:58px;position:relative;z-index:2}
  .messages .thinking-message .msg-content{display:block!important;visibility:visible!important;opacity:1!important;min-width:0}
  .messages .thinking-message .thinking-body{display:flex!important;visibility:visible!important;opacity:1!important;align-items:center!important;gap:10px!important;min-height:26px!important}
  .messages .thinking-message .velora-response-dots{display:inline-flex!important;visibility:visible!important;opacity:1!important;align-items:center!important;gap:6px!important;min-width:34px!important;min-height:22px!important;flex:0 0 auto!important}
  .messages .thinking-message .velora-response-dots span{display:block!important;visibility:visible!important;opacity:.35;width:7px!important;height:7px!important;min-width:7px!important;min-height:7px!important;flex:0 0 7px!important;border-radius:999px!important;background:#78e6e1!important;box-shadow:0 0 10px rgba(120,230,225,.28);animation:veloraMobileResponseDot 1.05s infinite ease-in-out!important}
  .messages .thinking-message .velora-response-dots span:nth-child(2){animation-delay:.14s!important}.messages .thinking-message .velora-response-dots span:nth-child(3){animation-delay:.28s!important}
  .messages .thinking-message .thinking-status{display:inline-block!important;visibility:visible!important;opacity:1!important}
  .custom-model-download{flex-direction:column}.custom-model-row{align-items:flex-start;flex-direction:column}.custom-model-actions{width:100%}.custom-model-actions button{flex:1}
}
@keyframes veloraMobileResponseDot{0%,60%,100%{transform:translateY(0) scale(.9);opacity:.28}30%{transform:translateY(-5px) scale(1.08);opacity:1}}
@media(prefers-reduced-motion:reduce){.messages .thinking-message .velora-response-dots span{animation:none!important;opacity:.72!important}}
'''
CSS.write_text(css)

# ---------------- PWA versioned shell ----------------
index = INDEX.read_text().replace('style-110550.css', 'style-110560.css').replace('app-110550.js', 'app-110560.js')
INDEX.write_text(index)
sw = SW.read_text().replace("const VERSION = '1.10.55';", "const VERSION = '1.10.56';").replace('style-110550.css', 'style-110560.css').replace('app-110550.js', 'app-110560.js')
SW.write_text(sw)

# Keep source + explicit immutable release assets aligned.
(ROOT / 'app/static/app-110560.js').write_text(APP.read_text())
(ROOT / 'app/static/style-110560.css').write_text(CSS.read_text())

# Version text in installer/service/source metadata. Historical static assets are left untouched.
for path in ROOT.rglob('*'):
    if not path.is_file() or path in {APP, CSS, INDEX, SW}:
        continue
    if path.suffix.lower() not in {'.py','.sh','.service','.conf','.json','.txt','.md','.html'} and path.name not in {'VERSION'}:
        continue
    try:
        value = path.read_text()
    except UnicodeDecodeError:
        continue
    if '1.10.55' in value:
        path.write_text(value.replace('1.10.55', '1.10.56'))

# Explicit VERSION file where present.
version_file = ROOT / 'VERSION'
if version_file.exists():
    version_file.write_text('1.10.56\n')

# Build-time assertions catch the exact regressions this release is supposed to prevent.
final_main = MAIN.read_text()
final_app = APP.read_text()
final_css = CSS.read_text()
assert 'VERSION = "1.10.56"' in final_main
assert final_main.count('"id": "veloraos-main"') >= 1
assert '"name": "VeloraOS Vision"' in final_main
assert '"name": "VeloraOS Coding"' in final_main
assert 'qwen2.5-coder-14b' not in final_main.split('CODING_MODEL_TIERS',1)[1].split('def coding_hardware_summary',1)[0]
assert 'validate_custom_model_tag' in final_main
assert '@app.post("/api/custom-models/install")' in final_main
assert 'requested_id.startswith("custom:")' in final_main
assert 'VISION_MODEL_PREFERENCES = (\n    "llava:7b",\n)' in final_main
assert 'function customModelsAdvancedHtml()' in final_app
assert 'function installCustomModel()' in final_app
assert "var requestedMode=S.codingMode?'veloraos-coding':normaliseChatModelSelection(S.selected);" in final_app
assert 'velora-response-dots' in final_app
assert 'mobile response activity' in final_css
print('VeloraOS 1.10.56 source patch complete.')
