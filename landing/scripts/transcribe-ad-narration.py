"""Local word timing and pronunciation check for the generated ad narration."""
import sys, json, shutil
import ssl
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/ad-production'
OUT.mkdir(parents=True,exist_ok=True)
if not (OUT/'narration-original.mp3').exists():
    shutil.copyfile(ROOT/'landing/video-src/audio/premiere-ad-v3-narration.mp3',OUT/'narration-original.mp3')
sys.path.insert(0,str(OUT/'python-packages'))
from faster_whisper import WhisperModel
import httpx
from huggingface_hub import set_client_factory
set_client_factory(lambda: httpx.Client(verify=ssl.create_default_context(), timeout=120, follow_redirects=True))
model=WhisperModel('base.en',device='cpu',compute_type='int8',cpu_threads=6,download_root=str(OUT/'models'))
segments,info=model.transcribe(str(OUT/'narration-original.mp3'),word_timestamps=True,language='en',beam_size=5)
result=[{'start':s.start,'end':s.end,'text':s.text,'words':[{'start':w.start,'end':w.end,'word':w.word} for w in s.words]} for s in segments]
(OUT/'narration-timing.json').write_text(json.dumps(result,indent=2),encoding='utf8')
print(json.dumps(result,indent=2))
