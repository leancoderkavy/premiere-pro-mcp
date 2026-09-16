"""Original instrumental score and sound design; no sampled recordings."""
from pathlib import Path
import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt, fftconvolve

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/ad-production'
OUT.mkdir(parents=True, exist_ok=True)
SR, DURATION = 48000, 30
rng = np.random.default_rng(150926)
n = SR * DURATION
music = np.zeros((n, 2), dtype=np.float64)
effects = np.zeros_like(music)

def add(track, signal, when, volume=1, pan=0):
    start = int(when * SR)
    if start >= n: return
    signal = signal[:n-start] * volume
    track[start:start+len(signal),0] += signal * np.sqrt((1-pan)/2)
    track[start:start+len(signal),1] += signal * np.sqrt((1+pan)/2)

def hz(midi): return 440 * 2 ** ((midi-69)/12)
def tone(midi, duration, kind='pad'):
    t = np.arange(int(duration*SR))/SR
    f = hz(midi)
    if kind == 'pad':
        s = sum(np.sin(2*np.pi*f*(1+d)*t + j*.31)/(j+1) for j,d in enumerate([0,.0017,-.0013,.003]))
        env = np.minimum(t/1.6,1) * np.minimum((duration-t)/2.3,1)
        return s * np.clip(env,0,1) * (.93+.07*np.sin(2*np.pi*.17*t))
    if kind == 'bell':
        return (np.sin(2*np.pi*f*t)*np.exp(-t*2.1) + .27*np.sin(2*np.pi*f*2.001*t)*np.exp(-t*4.2)) * np.minimum(t/.008,1)
    if kind == 'bass':
        return (np.sin(2*np.pi*f*t)+.16*np.sin(4*np.pi*f*t))*np.minimum(t/.018,1)*np.exp(-t*3.4)

# Open voicings: Dm9, Bbmaj7, Fmaj9, Cadd9. A small original motif carries the lift.
chords = [[50,57,60,64,69],[46,53,57,62,65],[53,60,64,67,72],[48,55,60,62,67]]
for ci,chord in enumerate(chords):
    start = ci*7.2
    for j,note in enumerate(chord):
        add(music,tone(note,9.2),start,.031,(-.7+j*.35))
    for k in range(12):
        when=start+k*.6
        if 3.6 <= when < 26.4:
            add(music,tone(chord[0]-12,.55,'bass'),when,.105)
    for k in range(24):
        when=start+k*.3
        if 4.8 <= when < 26.1:
            note=chord[[1,3,2,4,1,2,3,4][k%8]]+12
            add(music,tone(note,1.4,'bell'),when,.022 if when<12 else .032,.55*np.sin(k*1.5))

for k in range(40):
    when=4.8+k*.6
    if when>=26.4: break
    t=np.arange(int(.32*SR))/SR
    phase=2*np.pi*(47*t+90*.021*(1-np.exp(-t/.021)))
    kick=np.sin(phase)*np.exp(-t*16)*np.minimum(t/.002,1)
    add(music,kick,when,.13 if when>=12 else .075)
    if k%2:
        noise=rng.normal(0,1,len(t))
        snap=sosfilt(butter(2,[1700,7600],btype='bandpass',fs=SR,output='sos'),noise)*np.exp(-t*37)
        add(music,snap,when,.043,.12)
    t=np.arange(int(.09*SR))/SR
    tick=sosfilt(butter(2,7000,btype='highpass',fs=SR,output='sos'),rng.normal(0,1,len(t)))*np.exp(-t*70)
    add(music,tick,when+.3,.015,(-.5 if k%2 else .5))

# Airy transition sweeps and a restrained two-note end signature.
for when in [3.0,7.2,11.6,15.2,18.8,23.4]:
    duration=.85
    t=np.arange(int(duration*SR))/SR
    sweep=sosfilt(butter(2,[900,6000],btype='bandpass',fs=SR,output='sos'),rng.normal(0,1,len(t)))
    add(effects,sweep*np.sin(np.pi*t/duration)**3,when,.018,-.15)
for when,note in [(25.2,74),(25.8,81)]:
    add(music,tone(note,3.5,'bell'),when,.065,(-.25 if note==74 else .25))

# Deterministic diffuse stereo tail, with the dry voice left separate in the mix.
ir_t=np.arange(int(2.7*SR))/SR
for ch in [0,1]:
    impulse=rng.normal(0,1,len(ir_t))*np.exp(-ir_t*3.2)
    impulse[:int(.035*SR)]=0
    impulse=sosfilt(butter(2,4500,fs=SR,output='sos'),impulse)
    impulse *= .075 / np.sqrt(np.sum(impulse**2))
    music[:,ch] += fftconvolve(music[:,ch],impulse)[:n]
t=np.arange(n)/SR
fade=np.minimum(t/.8,1)*np.clip((30-t)/2,0,1)
music*=fade[:,None]
effects*=fade[:,None]
for name,signal in [('score-original.wav',music),('sound-design.wav',effects)]:
    signal=np.tanh(signal*1.2)
    wavfile.write(OUT/name,SR,(signal*32767).astype(np.int16))
    print(name, 'peak', round(float(np.max(np.abs(signal))),4))
