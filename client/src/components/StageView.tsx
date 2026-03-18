/**
 * StageView.tsx — Konva canvas stage for fixture placement.
 * Background: near-black with a subtle lighter "stage floor" rect at the bottom.
 * Clicking the background deselects any selected fixture.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Rect } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { useShowStore } from '../store/useShowStore.js';
import FixtureCircle from './FixtureCircle.js';
import { T } from '../theme.js';
import type { useWebSocket } from '../ws/useWebSocket.js';

interface Props {
  ws: ReturnType<typeof useWebSocket>;
}

export default function StageView({ ws }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [dropActive, setDropActive] = useState(false);

  const fixtures = useShowStore((s) => s.fixtures);
  const fixtureIds = useMemo(() => Object.keys(fixtures), [fixtures]);
  const setSelected = useShowStore((s) => s.setSelectedFixture);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observe = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    observe();
    const ro = new ResizeObserver(observe);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleStageClick = useCallback(
    (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
      if (e.target === e.target.getStage() || e.target.name() === 'bg') {
        setSelected(null);
      }
    },
    [setSelected]
  );

  // Stage floor rect covers the bottom 35% of the stage
  const floorH = Math.round(size.height * 0.35);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes('lites/fixture-id')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDropActive(true);
    }
  }, []);

  const handleDragLeave = useCallback(() => setDropActive(false), []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDropActive(false);
      const fixtureId = e.dataTransfer.getData('lites/fixture-id');
      if (!fixtureId || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = Math.round(e.clientX - rect.left);
      const y = Math.round(e.clientY - rect.top);
      ws.send({ type: 'moveFixture', fixtureId, x, y });
      useShowStore.getState().optimisticMoveFixture(fixtureId, x, y);
      useShowStore.getState().setSelectedFixture(fixtureId);
    },
    [ws]
  );

  return (
    <div
      ref={containerRef}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        flex: 1,
        overflow: 'hidden',
        background: T.bg,
        outline: dropActive ? `2px dashed ${T.accent}` : 'none',
        outlineOffset: -2,
      }}
    >
      <Stage
        width={size.width}
        height={size.height}
        onClick={handleStageClick}
        onTap={handleStageClick}
      >
        <Layer>
          {/* Full bg — catches deselect clicks */}
          <Rect
            name="bg"
            x={0} y={0}
            width={size.width}
            height={size.height}
            fill={T.bg}
          />
          {/* Subtle stage floor */}
          <Rect
            x={0}
            y={size.height - floorH}
            width={size.width}
            height={floorH}
            fill="#111111"
            listening={false}
          />
          {/* Floor edge highlight line */}
          <Rect
            x={0}
            y={size.height - floorH}
            width={size.width}
            height={1}
            fill={T.border}
            listening={false}
          />

          {fixtureIds.map((id) => (
            <FixtureCircle key={id} fixtureId={id} ws={ws} />
          ))}
        </Layer>
      </Stage>
    </div>
  );
}
