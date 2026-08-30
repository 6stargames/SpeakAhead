import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AacSession } from '@/session/AacSession';
import { store } from '@/state/store';

let originalMediaDevices: PropertyDescriptor | undefined;

class TestMediaStream {
  constructor(readonly tracks: MediaStreamTrack[] = []) {}
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks.filter((track) => track.kind === 'audio'); }
  getVideoTracks() { return this.tracks.filter((track) => track.kind === 'video'); }
}

function testTrack(kind: 'audio' | 'video') {
  return {
    kind,
    stop: vi.fn(),
    addEventListener: vi.fn(),
  } as unknown as MediaStreamTrack;
}

beforeEach(() => {
  store.reset();
  originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
  vi.stubGlobal('MediaStream', TestMediaStream);
});

afterEach(() => {
  if (originalMediaDevices) {
    Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices);
  } else {
    Reflect.deleteProperty(navigator, 'mediaDevices');
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('browser tab audio', () => {
  it('keeps only shared audio on its own recogniser path beside the microphone', async () => {
    const audio = testTrack('audio');
    const video = testTrack('video');
    const shared = new TestMediaStream([audio, video]);
    const getDisplayMedia = vi.fn(async () => shared as unknown as MediaStream);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getDisplayMedia },
    });
    const aac = new AacSession();
    store.set({ micActive: true });
    vi.spyOn(aac.graph, 'resume').mockResolvedValue();
    const attach = vi.spyOn(aac.graph, 'attachBrowserTab').mockResolvedValue();
    const micAttach = vi.spyOn(aac.graph, 'attachMicrophone').mockResolvedValue();

    await aac.startBrowserTabAudio();

    expect(getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: expect.any(Object), video: true }));
    expect(video.stop).toHaveBeenCalledOnce();
    expect(attach).toHaveBeenCalledOnce();
    expect((attach.mock.calls[0]?.[0] as unknown as TestMediaStream).getAudioTracks()).toEqual([audio]);
    expect(micAttach).not.toHaveBeenCalled();
    expect(store.getState().tabAudioActive).toBe(true);
    expect(store.getState().audioInputSource).toBe('microphone');
    expect(store.getState().micActive).toBe(true);
  });
});
