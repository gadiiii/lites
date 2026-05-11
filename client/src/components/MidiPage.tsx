import React, { useEffect } from 'react';
import { useShowStore } from '../store/useShowStore.js';
import { useShallow } from 'zustand/react/shallow';
import type { MidiMapping, MidiTarget, ClientMessage } from '../types.js';
import { T } from '../theme.js';
import { Btn, Input, Select, EmptyState } from '../ui.js';

interface MidiPageProps {
  ws: { send: (msg: ClientMessage) => void };
}

const TARGET_TYPES: MidiTarget['type'][] = [
  'fixtureParam', 'preset', 'blackout', 'cueGo', 'masterDimmer',
];

export default function MidiPage({ ws }: MidiPageProps) {
  const {
    midiMappings,
    midiPorts,
    activeMidiPort,
    midiLearnMappingId,
    fixtures,
  } = useShowStore(useShallow((s) => ({
    midiMappings: s.midiMappings,
    midiPorts: s.midiPorts,
    activeMidiPort: s.activeMidiPort,
    midiLearnMappingId: s.midiLearnMappingId,
    fixtures: s.fixtures,
  })));

  useEffect(() => {
    ws.send({ type: 'listMidiPorts' });
  }, [ws]);

  const addMapping = () => {
    ws.send({
      type: 'addMidiMapping',
      label: 'New Mapping',
      source: 'cc',
      channel: 0,
      number: 0,
      target: { type: 'masterDimmer' },
    });
  };

  const deleteMapping = (mappingId: string) => {
    ws.send({ type: 'deleteMidiMapping', mappingId });
  };

  const toggleLearn = (mappingId: string) => {
    if (midiLearnMappingId === mappingId) {
      ws.send({ type: 'midiLearnStop' });
    } else {
      ws.send({ type: 'midiLearnStart', mappingId });
    }
  };

  const updateMapping = (mappingId: string, changes: Partial<Omit<MidiMapping, 'id'>>) => {
    ws.send({ type: 'updateMidiMapping', mappingId, changes });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 16px',
        borderBottom: `1px solid ${T.border}`,
        flexShrink: 0,
        gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontWeight: 600, color: T.text, fontSize: 13 }}>MIDI Input</span>
          <Select
            value={activeMidiPort ?? ''}
            onChange={(e) => ws.send({ type: 'setMidiPort', port: e.target.value || null })}
          >
            <option value="">— No port —</option>
            {midiPorts.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </Select>
          <Btn variant="ghost" size="sm" onClick={() => ws.send({ type: 'listMidiPorts' })}>
            Refresh
          </Btn>
        </div>
        <Btn variant="primary" size="sm" onClick={addMapping}>+ Add Mapping</Btn>
      </div>

      {/* Mapping list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px' }}>
        {midiMappings.length === 0 ? (
          <EmptyState message='No MIDI mappings.' detail='Click "+ Add Mapping" to create one.' />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ color: T.muted, borderBottom: `1px solid ${T.border}` }}>
                <th style={thStyle}>Label</th>
                <th style={thStyle}>Source</th>
                <th style={thStyle}>Ch</th>
                <th style={thStyle}>Number</th>
                <th style={thStyle}>Target</th>
                <th style={thStyle}>Learn</th>
                <th style={thStyle} />
              </tr>
            </thead>
            <tbody>
              {midiMappings.map((m) => (
                <MappingRow
                  key={m.id}
                  mapping={m}
                  fixtures={fixtures}
                  isLearning={midiLearnMappingId === m.id}
                  onToggleLearn={() => toggleLearn(m.id)}
                  onDelete={() => deleteMapping(m.id)}
                  onUpdate={(changes) => updateMapping(m.id, changes)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Output driver panel */}
      <OutputDriverPanel ws={ws} />

      {/* OSC info panel */}
      <OscInfoPanel ws={ws} />
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '4px 8px',
  fontWeight: 500,
  fontSize: 11,
};

const tdStyle: React.CSSProperties = {
  padding: '4px 8px',
  verticalAlign: 'middle',
};

interface MappingRowProps {
  mapping: MidiMapping;
  fixtures: Record<string, import('../types.js').FixtureDef>;
  isLearning: boolean;
  onToggleLearn: () => void;
  onDelete: () => void;
  onUpdate: (changes: Partial<Omit<MidiMapping, 'id'>>) => void;
}

function MappingRow({ mapping, fixtures, isLearning, onToggleLearn, onDelete, onUpdate }: MappingRowProps) {
  return (
    <tr style={{ borderBottom: `1px solid ${T.border}`, color: T.text }}>
      <td style={tdStyle}>
        <Input
          value={mapping.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
          style={{ width: 100 }}
        />
      </td>
      <td style={tdStyle}>
        <Select
          value={mapping.source}
          onChange={(e) => onUpdate({ source: e.target.value as 'cc' | 'note' })}
        >
          <option value="cc">CC</option>
          <option value="note">Note</option>
        </Select>
      </td>
      <td style={tdStyle}>
        <Input
          type="number"
          min={0}
          max={15}
          value={mapping.channel}
          onChange={(e) => onUpdate({ channel: Number(e.target.value) })}
          style={{ width: 40 }}
        />
      </td>
      <td style={tdStyle}>
        <Input
          type="number"
          min={0}
          max={127}
          value={mapping.number}
          onChange={(e) => onUpdate({ number: Number(e.target.value) })}
          style={{ width: 50 }}
        />
      </td>
      <td style={tdStyle}>
        <TargetEditor target={mapping.target} fixtures={fixtures} onUpdate={(t) => onUpdate({ target: t })} />
      </td>
      <td style={tdStyle}>
        <Btn variant={isLearning ? 'danger' : 'ghost'} size="sm" onClick={onToggleLearn}>
          {isLearning ? '● LISTENING' : 'Learn'}
        </Btn>
      </td>
      <td style={tdStyle}>
        <Btn variant="ghost" size="sm" style={{ color: T.danger }} onClick={onDelete}>×</Btn>
      </td>
    </tr>
  );
}

function TargetEditor({ target, fixtures, onUpdate }: {
  target: MidiTarget;
  fixtures: Record<string, import('../types.js').FixtureDef>;
  onUpdate: (t: MidiTarget) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
      <Select
        value={target.type}
        onChange={(e) => onUpdate({ type: e.target.value as MidiTarget['type'] })}
      >
        {TARGET_TYPES.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </Select>
      {target.type === 'fixtureParam' && (
        <>
          <Select
            value={target.fixtureId ?? ''}
            onChange={(e) => onUpdate({ ...target, fixtureId: e.target.value })}
          >
            <option value="">fixture</option>
            {Object.values(fixtures).map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </Select>
          <Input
            placeholder="param"
            value={target.param ?? ''}
            onChange={(e) => onUpdate({ ...target, param: e.target.value })}
            style={{ width: 60 }}
          />
        </>
      )}
    </div>
  );
}

function OutputDriverPanel({ ws }: { ws: { send: (msg: ClientMessage) => void } }) {
  const { outputDriverConfig, outputDriverStatus } = useShowStore(useShallow((s) => ({
    outputDriverConfig: s.outputDriverConfig,
    outputDriverStatus: s.outputDriverStatus,
  })));

  const statusColor = outputDriverStatus === 'connected' ? T.success : outputDriverStatus === 'error' ? T.danger : T.dim;

  return (
    <div style={{
      borderTop: `1px solid ${T.border}`,
      padding: '10px 16px',
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      flexWrap: 'wrap',
    }}>
      <span style={{ fontWeight: 600, color: T.text, fontSize: 12 }}>DMX Output</span>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor, flexShrink: 0, display: 'inline-block' }} />
      <Select
        value={outputDriverConfig.driver}
        onChange={(e) => ws.send({ type: 'setOutputDriver', config: { ...outputDriverConfig, driver: e.target.value as import('../types.js').OutputDriverType } })}
      >
        <option value="enttec-usb">ENTTEC USB Pro</option>
        <option value="artnet">Art-Net</option>
        <option value="sacn">sACN (E1.31)</option>
        <option value="null">None (headless)</option>
      </Select>
      {outputDriverConfig.driver === 'enttec-usb' && (
        <Input
          placeholder="Serial port (e.g. /dev/ttyUSB0)"
          value={outputDriverConfig.serialPort ?? ''}
          onChange={(e) => ws.send({ type: 'setOutputDriver', config: { ...outputDriverConfig, serialPort: e.target.value } })}
          style={{ width: 180 }}
        />
      )}
      {outputDriverConfig.driver === 'artnet' && (
        <>
          <Input
            placeholder="IP (e.g. 255.255.255.255)"
            value={outputDriverConfig.artnetIp ?? ''}
            onChange={(e) => ws.send({ type: 'setOutputDriver', config: { ...outputDriverConfig, artnetIp: e.target.value } })}
            style={{ width: 150 }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: T.muted }}>
            Universe:
            <Input
              type="number"
              min={0}
              max={32767}
              value={outputDriverConfig.artnetUniverse ?? 0}
              onChange={(e) => ws.send({ type: 'setOutputDriver', config: { ...outputDriverConfig, artnetUniverse: Number(e.target.value) } })}
              style={{ width: 60 }}
            />
          </label>
        </>
      )}
      {outputDriverConfig.driver === 'sacn' && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: T.muted }}>
          Universe:
          <Input
            type="number"
            min={1}
            max={63999}
            value={outputDriverConfig.sacnUniverse ?? 1}
            onChange={(e) => ws.send({ type: 'setOutputDriver', config: { ...outputDriverConfig, sacnUniverse: Number(e.target.value) } })}
            style={{ width: 60 }}
          />
        </label>
      )}
    </div>
  );
}

function OscInfoPanel({ ws }: { ws: { send: (msg: ClientMessage) => void } }) {
  const oscConfig = useShowStore((s) => s.oscConfig);

  return (
    <div style={{
      borderTop: `1px solid ${T.border}`,
      padding: '10px 16px',
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      gap: 16,
    }}>
      <span style={{ fontWeight: 600, color: T.text, fontSize: 12 }}>OSC</span>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: T.muted }}>
        <input
          type="checkbox"
          checked={oscConfig.enabled}
          onChange={(e) => ws.send({ type: 'setOscConfig', config: { ...oscConfig, enabled: e.target.checked } })}
        />
        Enabled
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: T.muted }}>
        UDP Port:
        <Input
          type="number"
          min={1}
          max={65535}
          value={oscConfig.port}
          onChange={(e) => ws.send({ type: 'setOscConfig', config: { ...oscConfig, port: Number(e.target.value) } })}
          style={{ width: 70 }}
        />
      </label>
      <span style={{ fontSize: 11, color: T.muted }}>
        Addresses: /lites/fixture/:id/:param &nbsp;|&nbsp; /lites/preset/:id &nbsp;|&nbsp; /lites/master &nbsp;|&nbsp; /lites/blackout &nbsp;|&nbsp; /lites/cuelist/:id/go
      </span>
    </div>
  );
}

