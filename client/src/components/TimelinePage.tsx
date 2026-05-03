import React, { useState } from 'react';
import { useShowStore } from '../store/useShowStore.js';
import type { Timeline, TimelineEvent, TimelinePlayback, ClientMessage } from '../types.js';
import { T } from '../theme.js';

interface TimelinePageProps {
  ws: { send: (msg: ClientMessage) => void };
}

const RULER_HEIGHT = 28;
const ROW_HEIGHT = 32;
const LABEL_WIDTH = 120;
const PX_PER_SEC = 80; // pixels per second at zoom=1

export default function TimelinePage({ ws }: TimelinePageProps) {
  const { timelines, timelinePlayback, fixtures } = useShowStore((s) => ({
    timelines: s.timelines,
    timelinePlayback: s.timelinePlayback,
    fixtures: s.fixtures,
  }));

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  const selected = selectedId ? timelines[selectedId] : null;
  const playback: TimelinePlayback = (selectedId && timelinePlayback[selectedId]) ? timelinePlayback[selectedId] : { playing: false, position: 0 };

  const addTimeline = () => {
    ws.send({ type: 'addTimeline', name: 'New Timeline', duration: 10000, loop: false });
  };

  const deleteTimeline = (id: string) => {
    ws.send({ type: 'deleteTimeline', timelineId: id });
    if (selectedId === id) setSelectedId(null);
  };

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* ── Timeline list sidebar ──────────────────────────────────────────────── */}
      <div style={{
        width: 200,
        borderRight: `1px solid ${T.border}`,
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 10px',
          borderBottom: `1px solid ${T.border}`,
        }}>
          <span style={{ fontWeight: 600, fontSize: 12, color: T.text }}>Timelines</span>
          <button
            onClick={addTimeline}
            style={{
              background: T.accent,
              border: 'none',
              color: '#000',
              borderRadius: 3,
              padding: '2px 8px',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            +
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {Object.values(timelines).map((tl) => {
            const pb = timelinePlayback[tl.id];
            const isSelected = tl.id === selectedId;
            return (
              <div
                key={tl.id}
                onClick={() => setSelectedId(tl.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 10px',
                  background: isSelected ? T.surface2 : 'transparent',
                  borderLeft: isSelected ? `2px solid ${T.accent}` : '2px solid transparent',
                  cursor: 'pointer',
                  gap: 4,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {tl.name}
                  </div>
                  <div style={{ fontSize: 10, color: T.muted }}>{(tl.duration / 1000).toFixed(1)}s {tl.loop ? '↻' : ''}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {pb?.playing && <span style={{ color: '#2ecc71', fontSize: 10 }}>▶</span>}
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteTimeline(tl.id); }}
                    style={{ background: 'none', border: 'none', color: '#e74c3c', cursor: 'pointer', fontSize: 12, padding: 2 }}
                  >
                    ×
                  </button>
                </div>
              </div>
            );
          })}
          {Object.keys(timelines).length === 0 && (
            <div style={{ color: T.muted, fontSize: 12, textAlign: 'center', marginTop: 40, padding: '0 12px' }}>
              No timelines.<br />Click + to create one.
            </div>
          )}
        </div>
      </div>

      {/* ── Timeline editor ────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {selected ? (
          <TimelineEditor
            timeline={selected}
            playback={playback}
            fixtures={fixtures}
            zoom={zoom}
            onZoomChange={setZoom}
            ws={ws}
          />
        ) : (
          <div style={{ color: T.muted, fontSize: 13, margin: 'auto', textAlign: 'center' }}>
            Select a timeline to edit
          </div>
        )}
      </div>
    </div>
  );
}

// ── Timeline editor ────────────────────────────────────────────────────────────

interface TimelineEditorProps {
  timeline: Timeline;
  playback: TimelinePlayback;
  fixtures: Record<string, import('../types.js').FixtureDef>;
  zoom: number;
  onZoomChange: (z: number) => void;
  ws: { send: (msg: ClientMessage) => void };
}

function TimelineEditor({ timeline, playback, fixtures, zoom, onZoomChange, ws }: TimelineEditorProps) {
  const pxPerMs = (PX_PER_SEC * zoom) / 1000;
  const totalWidth = Math.max(timeline.duration * pxPerMs + 80, 400);

  // Fixture rows that appear on the timeline (fixtures referenced by events)
  const fixtureIds = [...new Set(timeline.events.map((e) => e.fixtureId))];

  const [editing, setEditing] = useState<{ name: string; duration: string; loop: boolean }>({
    name: timeline.name,
    duration: String(timeline.duration / 1000),
    loop: timeline.loop,
  });
  const [showProps, setShowProps] = useState(false);

  const saveProps = () => {
    ws.send({
      type: 'updateTimeline',
      timelineId: timeline.id,
      changes: {
        name: editing.name,
        duration: Math.max(100, Math.round(parseFloat(editing.duration) * 1000)),
        loop: editing.loop,
      },
    });
    setShowProps(false);
  };

  const [newEventFixtureId, setNewEventFixtureId] = useState('');
  const [newEventParam, setNewEventParam] = useState('dimmer');
  const [newEventTime, setNewEventTime] = useState('0');
  const [newEventValue, setNewEventValue] = useState('255');
  const [newEventFadeIn, setNewEventFadeIn] = useState('1000');

  const addEvent = () => {
    const fixtureId = newEventFixtureId || Object.keys(fixtures)[0];
    if (!fixtureId) return;
    ws.send({
      type: 'addTimelineEvent',
      timelineId: timeline.id,
      event: {
        fixtureId,
        param: newEventParam,
        time: Math.round(parseFloat(newEventTime) * 1000),
        value: Math.min(255, Math.max(0, parseInt(newEventValue))),
        fadeIn: Math.max(0, parseInt(newEventFadeIn)),
      },
    });
  };

  const deleteEvent = (eventId: string) => {
    ws.send({ type: 'deleteTimelineEvent', timelineId: timeline.id, eventId });
  };

  const isPlaying = playback.playing;
  const position = playback.position;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Transport bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px',
        borderBottom: `1px solid ${T.border}`,
        flexShrink: 0,
      }}>
        <span style={{ fontWeight: 600, color: T.text, fontSize: 13, minWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {timeline.name}
        </span>
        <button
          onClick={() => { isPlaying ? ws.send({ type: 'timelineStop', timelineId: timeline.id }) : ws.send({ type: 'timelineGo', timelineId: timeline.id }); }}
          style={{
            background: isPlaying ? '#e74c3c' : '#2ecc71',
            border: 'none',
            color: '#fff',
            borderRadius: 4,
            padding: '4px 12px',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          {isPlaying ? '■ Stop' : '▶ Play'}
        </button>
        <button
          onClick={() => ws.send({ type: 'timelineJump', timelineId: timeline.id, positionMs: 0 })}
          style={{ background: T.surface2, border: `1px solid ${T.border}`, color: T.muted, borderRadius: 4, padding: '4px 8px', fontSize: 11, cursor: 'pointer', fontFamily: T.font }}
        >
          ⏮
        </button>
        <span style={{ fontSize: 11, color: T.muted, fontFamily: 'monospace' }}>
          {(position / 1000).toFixed(2)}s / {(timeline.duration / 1000).toFixed(1)}s
        </span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: T.muted }}>
          Zoom:
          <input
            type="range"
            min={0.2}
            max={5}
            step={0.1}
            value={zoom}
            onChange={(e) => onZoomChange(Number(e.target.value))}
            style={{ width: 80 }}
          />
          {zoom.toFixed(1)}×
        </label>
        <button
          onClick={() => setShowProps(!showProps)}
          style={{ background: T.surface2, border: `1px solid ${T.border}`, color: T.muted, borderRadius: 4, padding: '4px 8px', fontSize: 11, cursor: 'pointer', marginLeft: 'auto', fontFamily: T.font }}
        >
          ⚙ Props
        </button>
      </div>

      {/* Properties drawer */}
      {showProps && (
        <div style={{ padding: '8px 12px', borderBottom: `1px solid ${T.border}`, display: 'flex', gap: 12, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
          <label style={labelStyle}>
            Name:
            <input value={editing.name} onChange={(e) => setEditing((p) => ({ ...p, name: e.target.value }))} style={inputStyle} />
          </label>
          <label style={labelStyle}>
            Duration (s):
            <input type="number" min={0.1} step={0.1} value={editing.duration} onChange={(e) => setEditing((p) => ({ ...p, duration: e.target.value }))} style={{ ...inputStyle, width: 70 }} />
          </label>
          <label style={{ ...labelStyle, cursor: 'pointer' }}>
            <input type="checkbox" checked={editing.loop} onChange={(e) => setEditing((p) => ({ ...p, loop: e.target.checked }))} />
            Loop
          </label>
          <button onClick={saveProps} style={{ background: T.accent, border: 'none', color: '#000', borderRadius: 4, padding: '4px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            Save
          </button>
        </div>
      )}

      {/* Ruler + event rows */}
      <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
        <div style={{ minWidth: totalWidth, position: 'relative' }}>
          {/* Ruler */}
          <TimelineRuler duration={timeline.duration} pxPerMs={pxPerMs} labelWidth={LABEL_WIDTH} />

          {/* Playhead */}
          <div style={{
            position: 'absolute',
            top: 0,
            left: LABEL_WIDTH + position * pxPerMs,
            width: 1,
            bottom: 0,
            background: '#f5a623',
            pointerEvents: 'none',
            zIndex: 10,
          }} />

          {/* Fixture rows */}
          {fixtureIds.length === 0 ? (
            <div style={{ color: T.muted, fontSize: 12, padding: '20px 12px' }}>
              No events yet. Add an event below.
            </div>
          ) : (
            fixtureIds.map((fixtureId) => {
              const fixture = fixtures[fixtureId];
              const events = timeline.events.filter((e) => e.fixtureId === fixtureId);
              return (
                <div key={fixtureId} style={{ display: 'flex', height: ROW_HEIGHT, borderBottom: `1px solid ${T.border}` }}>
                  <div style={{
                    width: LABEL_WIDTH,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 8px',
                    background: T.surface,
                    borderRight: `1px solid ${T.border}`,
                    fontSize: 11,
                    color: T.text,
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                  }}>
                    {fixture?.name ?? fixtureId}
                  </div>
                  <div style={{ position: 'relative', flex: 1 }}>
                    {events.map((ev) => (
                      <EventBlock key={ev.id} event={ev} pxPerMs={pxPerMs} onDelete={() => deleteEvent(ev.id)} />
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Add event form */}
      <div style={{
        borderTop: `1px solid ${T.border}`,
        padding: '8px 12px',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 11, color: T.muted, fontWeight: 600 }}>Add event:</span>
        <select value={newEventFixtureId} onChange={(e) => setNewEventFixtureId(e.target.value)} style={selectStyle}>
          {Object.values(fixtures).map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
        <input placeholder="param" value={newEventParam} onChange={(e) => setNewEventParam(e.target.value)} style={{ ...inputStyle, width: 70 }} />
        <label style={labelStyle}>
          t (s):
          <input type="number" min={0} step={0.1} value={newEventTime} onChange={(e) => setNewEventTime(e.target.value)} style={{ ...inputStyle, width: 60 }} />
        </label>
        <label style={labelStyle}>
          val:
          <input type="number" min={0} max={255} value={newEventValue} onChange={(e) => setNewEventValue(e.target.value)} style={{ ...inputStyle, width: 50 }} />
        </label>
        <label style={labelStyle}>
          fade (ms):
          <input type="number" min={0} step={100} value={newEventFadeIn} onChange={(e) => setNewEventFadeIn(e.target.value)} style={{ ...inputStyle, width: 70 }} />
        </label>
        <button
          onClick={addEvent}
          style={{ background: T.accent, border: 'none', color: '#000', borderRadius: 4, padding: '4px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
        >
          + Add
        </button>
      </div>
    </div>
  );
}

// ── Ruler ─────────────────────────────────────────────────────────────────────

function TimelineRuler({ duration, pxPerMs, labelWidth }: { duration: number; pxPerMs: number; labelWidth: number }) {
  const step = pxPerMs > 0.2 ? 1000 : pxPerMs > 0.05 ? 5000 : 10000;
  const marks: number[] = [];
  for (let ms = 0; ms <= duration; ms += step) marks.push(ms);

  return (
    <div style={{
      height: RULER_HEIGHT,
      background: T.surface,
      borderBottom: `1px solid ${T.border}`,
      display: 'flex',
      position: 'relative',
    }}>
      <div style={{ width: labelWidth, flexShrink: 0, borderRight: `1px solid ${T.border}` }} />
      <div style={{ flex: 1, position: 'relative' }}>
        {marks.map((ms) => (
          <div
            key={ms}
            style={{
              position: 'absolute',
              left: ms * pxPerMs,
              top: 0,
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
            }}
          >
            <div style={{ width: 1, height: 6, background: T.muted, marginTop: 'auto' }} />
            <span style={{ fontSize: 9, color: T.muted, marginLeft: 2, paddingBottom: 2 }}>
              {ms / 1000}s
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Event block ────────────────────────────────────────────────────────────────

function EventBlock({ event, pxPerMs, onDelete }: { event: TimelineEvent; pxPerMs: number; onDelete: () => void }) {
  const left = event.time * pxPerMs;
  const width = Math.max(event.fadeIn * pxPerMs, 6);
  const brightness = Math.round((event.value / 255) * 100);

  return (
    <div
      style={{
        position: 'absolute',
        top: 3,
        left,
        width,
        height: ROW_HEIGHT - 6,
        background: `hsl(210, 60%, ${20 + brightness * 0.3}%)`,
        border: '1px solid #00d4ff',
        borderRadius: 3,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 4px',
        overflow: 'hidden',
        cursor: 'default',
      }}
      title={`${event.param}=${event.value} @${event.time}ms fade${event.fadeIn}ms`}
    >
      <span style={{ fontSize: 9, color: '#e0f4ff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {event.param}:{event.value}
      </span>
      <button
        onClick={onDelete}
        style={{ background: 'none', border: 'none', color: '#e74c3c', cursor: 'pointer', fontSize: 11, padding: 0, lineHeight: 1, flexShrink: 0 }}
      >
        ×
      </button>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: T.surface2,
  border: `1px solid ${T.border}`,
  color: T.text,
  borderRadius: 4,
  padding: '2px 6px',
  fontSize: 12,
  fontFamily: T.font,
  width: 100,
};

const selectStyle: React.CSSProperties = {
  background: T.surface2,
  border: `1px solid ${T.border}`,
  color: T.text,
  borderRadius: 4,
  padding: '2px 4px',
  fontSize: 12,
  fontFamily: T.font,
};

const labelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 11,
  color: T.muted,
};
