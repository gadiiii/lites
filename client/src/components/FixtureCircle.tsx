/**
 * FixtureCircle.tsx
 *
 * Draggable fixture icon on the Konva stage.
 * Rendered as a layered PAR-can icon: outer ring → lens fill → dimmer overlay → lens highlight.
 * Selection: outer ring stroke → accent orange.
 * Lit: glow shadow bloom.
 */

import React, { useCallback } from 'react';
import { Circle, Group, Text } from 'react-konva';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { useShowStore } from '../store/useShowStore.js';
import { T } from '../theme.js';
import type { useWebSocket } from '../ws/useWebSocket.js';

const R_OUTER  = 28;  // outer ring
const R_LENS   = 20;  // lens fill
const R_HILITE = 7;   // lens highlight dot

interface Props {
  fixtureId: string;
  ws: ReturnType<typeof useWebSocket>;
}

export default function FixtureCircle({ fixtureId, ws }: Props) {
  const fixture      = useShowStore((s) => s.fixtures[fixtureId]);
  const params       = useShowStore((s) => s.fixtureParams[fixtureId]);
  const position     = useShowStore((s) => s.fixturePositions[fixtureId]);
  const isSelected   = useShowStore((s) => s.selectedFixtureIds.includes(fixtureId));
  const setSelected  = useShowStore((s) => s.setSelectedFixture);
  const toggleSelected = useShowStore((s) => s.toggleFixtureSelection);
  const move         = useShowStore((s) => s.optimisticMoveFixture);
  const blackout     = useShowStore((s) => s.blackout);

  if (!fixture || !params || !position) return null;

  // Effective dimmer factor (0 when blacked out)
  const dimmerFactor = blackout ? 0 : params.dimmer / 255;
  const r = Math.round(params.red   * dimmerFactor);
  const g = Math.round(params.green * dimmerFactor);
  const b = Math.round(params.blue  * dimmerFactor);
  const isOn = (r + g + b) > 8;

  const lensColor   = `rgb(${params.red},${params.green},${params.blue})`;
  const glowColor   = `rgb(${r},${g},${b})`;
  const dimmerAlpha = Math.max(0, 1 - dimmerFactor);  // 1=fully dark, 0=fully bright

  const handleDragMove = useCallback(
    (e: KonvaEventObject<DragEvent>) => {
      const node = e.target as Konva.Node;
      move(fixtureId, node.x(), node.y());
    },
    [fixtureId, move]
  );

  const handleDragEnd = useCallback(
    (e: KonvaEventObject<DragEvent>) => {
      const node = e.target as Konva.Node;
      const x = node.x(), y = node.y();
      move(fixtureId, x, y);
      ws.send({ type: 'moveFixture', fixtureId, x, y });
    },
    [fixtureId, ws, move]
  );

  const handleClick = useCallback((e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    const shiftHeld = 'shiftKey' in e.evt ? e.evt.shiftKey : false;
    if (shiftHeld) {
      toggleSelected(fixtureId);
    } else {
      setSelected(isSelected ? null : fixtureId);
    }
  }, [fixtureId, isSelected, setSelected, toggleSelected]);

  return (
    <Group
      x={position.x}
      y={position.y}
      draggable
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onClick={handleClick}
      onTap={handleClick}
    >
      {/* Glow bloom (behind everything, only when lit) */}
      {isOn && (
        <Circle
          radius={R_OUTER + 16}
          fill={glowColor}
          opacity={0.18}
          listening={false}
        />
      )}

      {/* Outer ring — body of the fixture */}
      <Circle
        radius={R_OUTER}
        fill={T.surface}
        stroke={isSelected ? T.accent : T.border2}
        strokeWidth={isSelected ? 2.5 : 1.5}
        shadowColor={isOn ? glowColor : undefined}
        shadowBlur={isOn ? 24 : 0}
        shadowOpacity={isOn ? 0.55 : 0}
      />

      {/* Lens fill — the colour zone */}
      <Circle
        radius={R_LENS}
        fill={lensColor}
        listening={false}
      />

      {/* Dimmer overlay — black layer fades lens proportionally */}
      <Circle
        radius={R_LENS}
        fill="#000000"
        opacity={dimmerAlpha}
        listening={false}
      />

      {/* Lens highlight — small specular dot */}
      <Circle
        radius={R_HILITE}
        x={-6}
        y={-6}
        fill="rgba(255,255,255,0.13)"
        listening={false}
      />

      {/* Name label */}
      <Text
        text={fixture.name}
        fontSize={10}
        fontFamily={T.mono}
        fill={isSelected ? T.text : T.muted}
        align="center"
        width={80}
        offsetX={40}
        y={R_OUTER + 5}
        listening={false}
      />
    </Group>
  );
}
