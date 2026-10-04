import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track, type RemoteTrack, type RemoteParticipant } from 'livekit-client';
import type { CallJoin } from '@lexisora/shared';
import { onRealtime } from '@/lib/socket';
import { useToast } from '@/lib/toast';
import { hubApi } from '../api-b';

type Props = { call: CallJoin; onClose: () => void };

const KIND_LABEL: Record<string, string> = { AUDIO: 'Audio call', VIDEO: 'Video call', SCREEN: 'Screen share' };

/**
 * Call window (spec §5.1): LiveKit when the API is configured with LIVEKIT_*, otherwise a local
 * camera / microphone / screen preview with the note "Calls need LiveKit configured".
 * The "This call may be recorded" banner shows only while recording is on.
 */
export function CallPanel({ call: initial, onClose }: Props) {
  const { toast, toastError } = useToast();
  const [call, setCall] = useState(initial);
  const [count, setCount] = useState(initial.participants.length);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(initial.kind === 'VIDEO');
  const [sharing, setSharing] = useState(initial.kind === 'SCREEN');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const localVideo = useRef<HTMLVideoElement>(null);
  const screenVideo = useRef<HTMLVideoElement>(null);
  const remoteGrid = useRef<HTMLDivElement>(null);
  const roomRef = useRef<Room | null>(null);
  const streams = useRef<{ media: MediaStream | null; screen: MediaStream | null }>({ media: null, screen: null });
  const left = useRef(false);
  const live = call.provider === 'livekit' && !!call.url && !!call.token;

  // Timer from the server start time.
  useEffect(() => {
    const start = new Date(call.startedAt).getTime();
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [call.startedAt]);

  // Realtime: participants, recording, ended.
  useEffect(() => {
    const offs = [
      onRealtime<{ callId: string; count: number }>('call:participants', (p) => p.callId === call.callId && setCount(p.count)),
      onRealtime<{ callId: string; on: boolean }>('call:recording', (p) => p.callId === call.callId && setCall((c) => ({ ...c, recording: p.on }))),
      onRealtime<{ callId: string }>('call:ended', (p) => {
        if (p.callId !== call.callId) return;
        toast('Call ended');
        cleanup();
        onClose();
      }),
    ];
    return () => offs.forEach((o) => o());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call.callId]);

  function stopLocal() {
    for (const s of [streams.current.media, streams.current.screen]) s?.getTracks().forEach((t) => t.stop());
    streams.current = { media: null, screen: null };
  }

  function cleanup() {
    stopLocal();
    void roomRef.current?.disconnect();
    roomRef.current = null;
  }

  // Connect: LiveKit room, or local preview.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (live) {
          const room = new Room({ adaptiveStream: true, dynacast: true });
          roomRef.current = room;
          const attach = (track: RemoteTrack, participant: RemoteParticipant) => {
            const el = track.attach();
            el.dataset.participant = participant.identity;
            if (track.kind === Track.Kind.Video) {
              const tile = document.createElement('div');
              tile.className = 'wp-call-tile';
              tile.dataset.sid = track.sid ?? '';
              tile.appendChild(el);
              const name = document.createElement('span');
              name.className = 'wp-call-name';
              name.textContent = participant.name || participant.identity;
              tile.appendChild(name);
              remoteGrid.current?.appendChild(tile);
            } else remoteGrid.current?.appendChild(el);
          };
          room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => attach(track, participant));
          room.on(RoomEvent.TrackUnsubscribed, (track) => {
            track.detach().forEach((el) => el.remove());
            remoteGrid.current?.querySelector(`[data-sid="${track.sid}"]`)?.remove();
          });
          await room.connect(call.url!, call.token!);
          if (cancelled) return void room.disconnect();
          await room.localParticipant.setMicrophoneEnabled(true);
          if (call.kind === 'VIDEO') await room.localParticipant.setCameraEnabled(true);
          if (call.kind === 'SCREEN') await room.localParticipant.setScreenShareEnabled(true);
          const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
          if (camPub?.track && localVideo.current) camPub.track.attach(localVideo.current);
          const scrPub = room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
          if (scrPub?.track && screenVideo.current) scrPub.track.attach(screenVideo.current);
        } else {
          const media = await navigator.mediaDevices.getUserMedia({ audio: true, video: call.kind === 'VIDEO' });
          if (cancelled) return void media.getTracks().forEach((t) => t.stop());
          streams.current.media = media;
          if (localVideo.current) localVideo.current.srcObject = media;
          if (call.kind === 'SCREEN') await startScreen();
        }
      } catch (e) {
        setError((e as Error).message || 'Could not access the camera or microphone');
      }
    })();
    return () => {
      cancelled = true;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startScreen() {
    if (live && roomRef.current) {
      await roomRef.current.localParticipant.setScreenShareEnabled(true);
      const pub = roomRef.current.localParticipant.getTrackPublication(Track.Source.ScreenShare);
      if (pub?.track && screenVideo.current) pub.track.attach(screenVideo.current);
      setSharing(true);
      return;
    }
    const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    streams.current.screen = screen;
    if (screenVideo.current) screenVideo.current.srcObject = screen;
    screen.getVideoTracks()[0]?.addEventListener('ended', () => setSharing(false));
    setSharing(true);
  }

  async function toggleScreen() {
    try {
      if (sharing) {
        if (live) await roomRef.current?.localParticipant.setScreenShareEnabled(false);
        streams.current.screen?.getTracks().forEach((t) => t.stop());
        streams.current.screen = null;
        setSharing(false);
      } else await startScreen();
    } catch (e) {
      toastError(e);
    }
  }

  async function toggleMic() {
    const next = !micOn;
    if (live) await roomRef.current?.localParticipant.setMicrophoneEnabled(next);
    streams.current.media?.getAudioTracks().forEach((t) => (t.enabled = next));
    setMicOn(next);
  }

  async function toggleCam() {
    const next = !camOn;
    try {
      if (live && roomRef.current) {
        await roomRef.current.localParticipant.setCameraEnabled(next);
        const pub = roomRef.current.localParticipant.getTrackPublication(Track.Source.Camera);
        if (next && pub?.track && localVideo.current) pub.track.attach(localVideo.current);
      } else if (next) {
        const v = await navigator.mediaDevices.getUserMedia({ video: true });
        const media = streams.current.media ?? new MediaStream();
        v.getVideoTracks().forEach((t) => media.addTrack(t));
        streams.current.media = media;
        if (localVideo.current) localVideo.current.srcObject = media;
      } else {
        streams.current.media?.getVideoTracks().forEach((t) => {
          t.stop();
          streams.current.media?.removeTrack(t);
        });
      }
      setCamOn(next);
    } catch (e) {
      toastError(e);
    }
  }

  async function toggleRecording() {
    try {
      const r = await hubApi.recording(call.callId, !call.recording);
      setCall(r);
      toast(r.recording ? 'Recording started' : 'Recording stopped');
    } catch (e) {
      toastError(e);
    }
  }

  async function leave() {
    if (left.current) return;
    left.current = true;
    cleanup();
    try {
      const r = await hubApi.leaveCall(call.callId);
      toast(r.ended ? 'Call ended' : 'You left the call');
    } catch {
      /* the call may already be over */
    }
    onClose();
  }

  const mm = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
  return (
    <div className="dialog-backdrop">
      <div className="dialog dialog-wide wp-call" role="dialog" aria-modal aria-label={`${KIND_LABEL[call.kind] ?? 'Call'} in ${call.channelLabel}`}>
        <div className="row-between">
          <div>
            <div className="kicker">{KIND_LABEL[call.kind] ?? 'Call'} · {mm} · {count} {count === 1 ? 'participant' : 'participants'}</div>
            <div className="dialog-title" style={{ margin: '2px 0 0' }}>{call.channelLabel}</div>
          </div>
          {call.recording && <span className="wp-rec" role="status">REC</span>}
        </div>
        {call.recording && <div className="note" style={{ marginTop: 10 }}>This call may be recorded</div>}
        {call.notice && <div className="note" style={{ marginTop: 10 }}>{call.notice} — showing your local camera, microphone and screen preview only.</div>}
        {error && <div className="field-error" role="alert" style={{ marginTop: 10 }}>{error}</div>}
        <div className="wp-call-grid">
          <div className="wp-call-tile">
            {/* Video elements stay mounted so streams can attach before the tile is shown. */}
            <video ref={localVideo} autoPlay playsInline muted style={{ display: camOn ? 'block' : 'none' }} />
            {!camOn && <div className="placeholder-media wp-call-off">{micOn ? 'Camera off' : 'Camera and mic off'}</div>}
            <span className="wp-call-name">You{micOn ? '' : ' · muted'}</span>
          </div>
          <div className="wp-call-tile" style={{ display: sharing ? undefined : 'none' }}>
            <video ref={screenVideo} autoPlay playsInline muted />
            <span className="wp-call-name">Your screen</span>
          </div>
          <div ref={remoteGrid} style={{ display: 'contents' }} />
          {!live && count > 1 && (
            <div className="wp-call-tile">
              <div className="placeholder-media wp-call-off">{count - 1} other {count - 1 === 1 ? 'person' : 'people'} in this call</div>
            </div>
          )}
        </div>
        <div className="dialog-actions" style={{ flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={() => void toggleMic()} aria-pressed={!micOn}>{micOn ? 'Mute' : 'Unmute'}</button>
          <button className="btn btn-secondary" onClick={() => void toggleCam()} aria-pressed={camOn}>{camOn ? 'Stop camera' : 'Camera'}</button>
          <button className="btn btn-secondary" onClick={() => void toggleScreen()} aria-pressed={sharing}>{sharing ? 'Stop sharing' : 'Share screen'}</button>
          {call.canRecord && <button className="btn btn-secondary" onClick={() => void toggleRecording()}>{call.recording ? 'Stop recording' : 'Record'}</button>}
          <button className="btn btn-danger" onClick={() => void leave()}>Leave</button>
        </div>
      </div>
    </div>
  );
}
