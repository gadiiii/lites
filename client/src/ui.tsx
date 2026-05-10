/**
 * Shared UI primitives for the lites DMX controller.
 * No state, no hooks, no context — pure style wrappers.
 * All components accept a `style` override for one-off adjustments.
 */
import React from 'react';
import { T } from './theme.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type BtnVariant = 'primary' | 'ghost' | 'danger' | 'active';
export type BtnSize    = 'sm' | 'md';

// ── Btn ───────────────────────────────────────────────────────────────────────

interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: BtnSize;
}

export function Btn({ variant = 'ghost', size = 'md', style, ...rest }: BtnProps) {
  const base: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    border: `1px solid ${
      variant === 'primary' ? T.accent
      : variant === 'active'  ? T.accent
      : variant === 'danger'  ? T.danger
      : T.border2
    }`,
    borderRadius: T.radiusSm,
    background:
      variant === 'primary' ? T.accent
      : variant === 'active'  ? T.accentDim
      : 'transparent',
    color:
      variant === 'primary' ? '#000'
      : variant === 'active'  ? T.accent
      : variant === 'danger'  ? T.danger
      : T.muted,
    fontFamily: T.mono,
    fontSize: size === 'sm' ? 10 : 11,
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    padding: size === 'sm' ? '3px 8px' : '5px 12px',
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'border-color 0.1s, color 0.1s, background 0.1s',
    userSelect: 'none',
    lineHeight: 1.4,
    ...style,
  };
  return <button style={base} {...rest} />;
}

// ── Input ─────────────────────────────────────────────────────────────────────

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  hasError?: boolean;
}

export function Input({ hasError, style, ...rest }: InputProps) {
  return (
    <input
      style={{
        background: T.surface2,
        border: `1px solid ${hasError ? T.danger : T.border2}`,
        borderRadius: T.radiusSm,
        color: T.text,
        fontFamily: T.font,
        fontSize: 12,
        padding: '5px 9px',
        outline: 'none',
        ...style,
      }}
      {...rest}
    />
  );
}

// ── Select ────────────────────────────────────────────────────────────────────

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {}

export function Select({ style, children, ...rest }: SelectProps) {
  return (
    <select
      style={{
        background: T.surface2,
        border: `1px solid ${T.border2}`,
        borderRadius: T.radiusSm,
        color: T.text,
        fontFamily: T.font,
        fontSize: 12,
        padding: '5px 8px',
        outline: 'none',
        cursor: 'pointer',
        ...style,
      }}
      {...rest}
    >
      {children}
    </select>
  );
}

// ── Label ─────────────────────────────────────────────────────────────────────
// Micro-caps uppercase label, typically rendered above a field.

interface LabelProps extends React.HTMLAttributes<HTMLElement> {
  as?: 'label' | 'span' | 'div';
  htmlFor?: string;
}

export function Label({ as: Tag = 'span', style, ...rest }: LabelProps) {
  return (
    <Tag
      style={{
        display: 'block',
        fontFamily: T.mono,
        fontSize: 9,
        fontWeight: 600,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: T.dim,
        marginBottom: 4,
        ...style,
      }}
      {...rest}
    />
  );
}

// ── Badge ─────────────────────────────────────────────────────────────────────

export type BadgeVariant = 'default' | 'accent' | 'danger' | 'success';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export function Badge({ variant = 'default', style, ...rest }: BadgeProps) {
  const colors: Record<BadgeVariant, { bg: string; border: string; color: string }> = {
    default: { bg: T.surface2,       border: T.border,         color: T.muted   },
    accent:  { bg: `${T.accent}22`,  border: `${T.accent}55`,  color: T.accent  },
    danger:  { bg: `${T.danger}22`,  border: `${T.danger}55`,  color: T.danger  },
    success: { bg: `${T.success}22`, border: `${T.success}55`, color: T.success },
  };
  const c = colors[variant];
  return (
    <span
      style={{
        fontFamily: T.mono,
        fontSize: 9,
        fontWeight: 600,
        padding: '2px 7px',
        borderRadius: T.radiusSm,
        background: c.bg,
        border: `1px solid ${c.border}`,
        color: c.color,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        flexShrink: 0,
        ...style,
      }}
      {...rest}
    />
  );
}

// ── Divider ───────────────────────────────────────────────────────────────────

interface DividerProps {
  orientation?: 'horizontal' | 'vertical';
  style?: React.CSSProperties;
}

export function Divider({ orientation = 'horizontal', style }: DividerProps) {
  return (
    <div
      style={
        orientation === 'vertical'
          ? { width: 1, alignSelf: 'stretch', background: T.border, flexShrink: 0, ...style }
          : { height: 1, background: T.border, ...style }
      }
    />
  );
}

// ── Section ───────────────────────────────────────────────────────────────────
// Titled section block with optional toolbar on the right.

interface SectionProps {
  title: string;
  toolbar?: React.ReactNode;
  children?: React.ReactNode;
  style?: React.CSSProperties;
  headerStyle?: React.CSSProperties;
}

export function Section({ title, toolbar, children, style, headerStyle }: SectionProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', ...style }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '9px 14px',
          borderBottom: `1px solid ${T.border}`,
          flexShrink: 0,
          ...headerStyle,
        }}
      >
        <span
          style={{
            fontFamily: T.mono,
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: T.dim,
          }}
        >
          {title}
        </span>
        {toolbar}
      </div>
      {children}
    </div>
  );
}

// ── SubTabBar ─────────────────────────────────────────────────────────────────
// Inner navigation bar for pages with sub-sections (ShowPage, SettingsPage, PatchPage).

interface SubTab<Id extends string> {
  id: Id;
  label: string;
}

interface SubTabBarProps<Id extends string> {
  tabs: SubTab<Id>[];
  active: Id;
  onChange: (id: Id) => void;
  toolbar?: React.ReactNode;
  style?: React.CSSProperties;
}

export function SubTabBar<Id extends string>({
  tabs, active, onChange, toolbar, style,
}: SubTabBarProps<Id>) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        height: T.subNavH,
        background: T.surface,
        borderBottom: `1px solid ${T.border}`,
        flexShrink: 0,
        paddingLeft: 6,
        ...style,
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: isActive ? `2px solid ${T.accent}` : '2px solid transparent',
              color: isActive ? T.textSub : T.dim,
              fontFamily: T.mono,
              fontSize: 10,
              fontWeight: isActive ? 600 : 400,
              letterSpacing: '0.10em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              padding: '0 12px',
              height: '100%',
              transition: 'color 0.12s, border-color 0.12s',
            }}
          >
            {tab.label}
          </button>
        );
      })}
      {toolbar && (
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', paddingRight: 10 }}>
          {toolbar}
        </div>
      )}
    </div>
  );
}

// ── EmptyState ────────────────────────────────────────────────────────────────

interface EmptyStateProps {
  message: string;
  detail?: string;
  style?: React.CSSProperties;
}

export function EmptyState({ message, detail, style }: EmptyStateProps) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        padding: 40,
        ...style,
      }}
    >
      <span style={{ fontFamily: T.mono, fontSize: 12, color: T.dim }}>{message}</span>
      {detail && (
        <span
          style={{
            fontFamily: T.mono,
            fontSize: 10,
            color: T.dim,
            opacity: 0.6,
            textAlign: 'center',
            maxWidth: 240,
          }}
        >
          {detail}
        </span>
      )}
    </div>
  );
}
