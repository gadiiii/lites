import React, { useState, useMemo } from 'react';
import { T } from '../theme.js';
import { useShowStore } from '../store/useShowStore.js';
import type { EffectTemplate, EffectInstance } from '../types.js';
import type { useWebSocket } from '../ws/useWebSocket.js';

interface Props { ws: ReturnType<typeof useWebSocket>; }

type Category = 'all' | 'dimmer' | 'color' | 'rgb';

const WAVEFORM_ICONS: Record<string, string> = {
  sine: '∿',
  square: '⊓',
  triangle: '⋀',
  sawtooth: '⟋',
  random: '⚡',
};

const CATEGORY_COLORS: Record<string, string> = {
  dimmer: '#888',
  color: '#f97316',
  rgb: '#4ade80',
};

// ── AddEffectPanel ────────────────────────────────────────────────────────────
function AddEffectPanel({
  template,
  fixtures,
  onAdd,
  onClose,
}: {
  template: EffectTemplate;
  fixtures: Record<string, { name: string }>;
  onAdd: (fixtureIds: string[], overrides: { rateBpm?: number; min?: number; max?: number; phaseSpread?: number }) => void;
  onClose: () => void;
}) {
  const [selectedFixtures, setSelectedFixtures] = useState<Set<string>>(new Set(Object.keys(fixtures)));
  const [rateBpm, setRateBpm] = useState(template.rateBpm);
  const [min, setMin] = useState(template.min);
  const [max, setMax] = useState(template.max);
  const [phaseSpread, setPhaseSpread] = useState(template.phaseSpread);

  const toggleFixture = (id: string) => {
    setSelectedFixtures((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const inp: React.CSSProperties = {
    background: T.surface2,
    border: `1px solid ${T.border}`,
    borderRadius: T.radiusSm,
    color: T.text,
    fontFamily: T.mono,
    fontSize: 12,
    padding: '4px 8px',
    width: 70,
    outline: 'none',
  };

  return (
    <div style={{
      background: T.surface2,
      border: `1px solid ${T.accent}`,
      borderRadius: T.radius,
      padding: 16,
      marginBottom: 16,
    }}>
      <div style={{ fontWeight: 600, fontSize: 13, color: T.text, marginBottom: 12 }}>
        Add: {template.name}
      </div>

      {/* Fixture select */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 10, color: T.dim, fontFamily: T.mono, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
          Apply to fixtures
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {Object.entries(fixtures).map(([id, f]) => (
            <button
              key={id}
              onClick={() => toggleFixture(id)}
              style={{
                padding: '3px 10px',
                borderRadius: T.radiusSm,
                border: `1px solid ${selectedFixtures.has(id) ? T.accent : T.border}`,
                background: selectedFixtures.has(id) ? T.accentDim : 'none',
                color: selectedFixtures.has(id) ? T.accent : T.muted,
                fontFamily: T.font,
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              {f.name}
            </button>
          ))}
        </div>
      </div>

      {/* Overrides */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 10, color: T.dim, fontFamily: T.mono, textTransform: 'uppercase', marginBottom: 4 }}>Rate (BPM)</div>
          <input style={inp} type="number" min={6} max={600} value={rateBpm} onChange={(e) => setRateBpm(Number(e.target.value))} />
        </div>
        <div>
          <div style={{ fontSize: 10, color: T.dim, fontFamily: T.mono, textTransform: 'uppercase', marginBottom: 4 }}>Min</div>
          <input style={inp} type="number" min={0} max={255} value={min} onChange={(e) => setMin(Number(e.target.value))} />
        </div>
        <div>
          <div style={{ fontSize: 10, color: T.dim, fontFamily: T.mono, textTransform: 'uppercase', marginBottom: 4 }}>Max</div>
          <input style={inp} type="number" min={0} max={255} value={max} onChange={(e) => setMax(Number(e.target.value))} />
        </div>
        <div>
          <div style={{ fontSize: 10, color: T.dim, fontFamily: T.mono, textTransform: 'uppercase', marginBottom: 4 }}>Phase °</div>
          <input style={inp} type="number" min={0} max={360} value={phaseSpread} onChange={(e) => setPhaseSpread(Number(e.target.value))} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          disabled={selectedFixtures.size === 0}
          onClick={() => onAdd(Array.from(selectedFixtures), { rateBpm, min, max, phaseSpread })}
          style={{
            background: selectedFixtures.size > 0 ? T.accent : T.surface2,
            border: 'none',
            borderRadius: T.radiusSm,
            color: selectedFixtures.size > 0 ? '#000' : T.dim,
            fontFamily: T.font,
            fontSize: 12,
            fontWeight: 600,
            padding: '6px 16px',
            cursor: selectedFixtures.size > 0 ? 'pointer' : 'not-allowed',
          }}
        >
          Add to Show
        </button>
        <button
          onClick={onClose}
          style={{ background: 'none', border: `1px solid ${T.border}`, borderRadius: T.radiusSm, color: T.muted, fontFamily: T.font, fontSize: 12, padding: '6px 12px', cursor: 'pointer' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Active Effect Row ─────────────────────────────────────────────────────────
function EffectInstanceRow({
  instance,
  templates,
  fixtures,
  onToggle,
  onRemove,
}: {
  instance: EffectInstance;
  templates: EffectTemplate[];
  fixtures: Record<string, { name: string }>;
  onToggle: (active: boolean) => void;
  onRemove: () => void;
}) {
  const tmpl = templates.find((t) => t.id === instance.templateId);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '8px 12px',
      borderBottom: `1px solid ${T.border}`,
      opacity: instance.active ? 1 : 0.5,
    }}>
      {/* Toggle */}
      <button
        onClick={() => onToggle(!instance.active)}
        title={instance.active ? 'Pause effect' : 'Resume effect'}
        style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          border: `2px solid ${instance.active ? T.accent : T.border}`,
          background: instance.active ? T.accentDim : 'none',
          color: instance.active ? T.accent : T.dim,
          cursor: 'pointer',
          fontSize: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {instance.active ? '●' : '○'}
      </button>

      {/* Effect info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: T.text, fontWeight: 500 }}>
          {tmpl?.name ?? instance.templateId}
          <span style={{ marginLeft: 8, fontSize: 10, color: CATEGORY_COLORS[tmpl?.category ?? ''] ?? T.dim, fontFamily: T.mono }}>
            {WAVEFORM_ICONS[tmpl?.waveform ?? '']} {tmpl?.param}
          </span>
        </div>
        <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono, marginTop: 2 }}>
          {instance.fixtureIds.map((id) => fixtures[id]?.name ?? id).join(' · ')}
        </div>
      </div>

      {/* Rate */}
      <div style={{ fontFamily: T.mono, fontSize: 11, color: T.muted, flexShrink: 0 }}>
        {instance.rateBpm ?? tmpl?.rateBpm} BPM
      </div>

      {/* Remove */}
      <button
        onClick={onRemove}
        style={{ background: 'none', border: `1px solid ${T.border}`, borderRadius: T.radiusSm, color: T.danger, fontFamily: T.font, fontSize: 11, padding: '3px 8px', cursor: 'pointer', flexShrink: 0 }}
      >
        Remove
      </button>
    </div>
  );
}

// ── Main EffectsPage ──────────────────────────────────────────────────────────
export default function EffectsPage({ ws }: Props) {
  const effectTemplates = useShowStore((s) => s.effectTemplates);
  const effectInstances = useShowStore((s) => s.effectInstances);
  const fixtures = useShowStore((s) => s.fixtures);

  const [categoryFilter, setCategoryFilter] = useState<Category>('all');
  const [addingTemplate, setAddingTemplate] = useState<EffectTemplate | null>(null);

  const filteredTemplates = useMemo(
    () => categoryFilter === 'all'
      ? effectTemplates
      : effectTemplates.filter((t) => t.category === categoryFilter),
    [effectTemplates, categoryFilter]
  );

  const handleAdd = (
    template: EffectTemplate,
    fixtureIds: string[],
    overrides: { rateBpm?: number; min?: number; max?: number; phaseSpread?: number }
  ) => {
    ws.send({ type: 'addEffect', templateId: template.id, fixtureIds, ...overrides });
    setAddingTemplate(null);
  };

  const categories: { id: Category; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'dimmer', label: 'Dimmer' },
    { id: 'color', label: 'Color' },
    { id: 'rgb', label: 'RGB' },
  ];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Active effects panel */}
      <div style={{
        borderBottom: `1px solid ${T.border}`,
        flexShrink: 0,
        maxHeight: '40%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '10px 16px',
          borderBottom: `1px solid ${T.border}`,
          background: T.surface,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexShrink: 0,
        }}>
          <span style={{ fontFamily: T.mono, fontSize: 11, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Active Effects
          </span>
          {effectInstances.filter((i) => i.active).length > 0 && (
            <span style={{
              background: T.accent,
              color: '#000',
              borderRadius: 10,
              fontSize: 10,
              fontWeight: 700,
              padding: '1px 6px',
              fontFamily: T.mono,
            }}>
              {effectInstances.filter((i) => i.active).length}
            </span>
          )}
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {effectInstances.length === 0 ? (
            <div style={{ padding: '16px 16px', color: T.dim, fontSize: 12 }}>
              No effects running. Select a template below to add one.
            </div>
          ) : (
            effectInstances.map((inst) => (
              <EffectInstanceRow
                key={inst.id}
                instance={inst}
                templates={effectTemplates}
                fixtures={fixtures}
                onToggle={(active) => ws.send({ type: 'toggleEffect', instanceId: inst.id, active })}
                onRemove={() => ws.send({ type: 'removeEffect', instanceId: inst.id })}
              />
            ))
          )}
        </div>
      </div>

      {/* Effect library */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{
          padding: '10px 16px',
          borderBottom: `1px solid ${T.border}`,
          background: T.surface,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexShrink: 0,
        }}>
          <span style={{ fontFamily: T.mono, fontSize: 11, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginRight: 8 }}>
            Effect Library
          </span>
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategoryFilter(c.id)}
              style={{
                background: categoryFilter === c.id ? T.surface2 : 'none',
                border: `1px solid ${categoryFilter === c.id ? T.border2 : T.border}`,
                borderRadius: T.radiusSm,
                color: categoryFilter === c.id ? T.text : T.muted,
                fontFamily: T.font,
                fontSize: 11,
                padding: '3px 10px',
                cursor: 'pointer',
              }}
            >
              {c.label}
            </button>
          ))}
          <div style={{ marginLeft: 'auto', color: T.dim, fontSize: 11, fontFamily: T.mono }}>
            {filteredTemplates.length} templates
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {addingTemplate && (
            <AddEffectPanel
              template={addingTemplate}
              fixtures={fixtures}
              onAdd={(fixtureIds, overrides) => handleAdd(addingTemplate, fixtureIds, overrides)}
              onClose={() => setAddingTemplate(null)}
            />
          )}

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: 8,
          }}>
            {filteredTemplates.map((tmpl) => (
              <button
                key={tmpl.id}
                onClick={() => setAddingTemplate(addingTemplate?.id === tmpl.id ? null : tmpl)}
                style={{
                  background: addingTemplate?.id === tmpl.id ? T.accentDim : T.surface,
                  border: `1px solid ${addingTemplate?.id === tmpl.id ? T.accent : T.border}`,
                  borderRadius: T.radiusSm,
                  padding: '10px 12px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  transition: 'border-color 0.15s, background 0.15s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 14, color: CATEGORY_COLORS[tmpl.category] }}>
                    {WAVEFORM_ICONS[tmpl.waveform]}
                  </span>
                  <span style={{
                    fontSize: 9,
                    color: CATEGORY_COLORS[tmpl.category],
                    fontFamily: T.mono,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}>
                    {tmpl.param}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: T.text, fontWeight: 500, lineHeight: 1.3 }}>
                  {tmpl.name}
                </div>
                <div style={{ fontSize: 10, color: T.dim, fontFamily: T.mono, marginTop: 3 }}>
                  {tmpl.rateBpm} BPM{tmpl.phaseSpread > 0 ? ` · ${tmpl.phaseSpread}°` : ''}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
