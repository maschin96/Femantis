import type { ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

/** One captioned command group of the ribbon tray. */
export function RibbonGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ribbon-group" role="group" aria-label={label}>
      <div className="ribbon-group-items">{children}</div>
      <div className="ribbon-group-label" aria-hidden="true">
        {label}
      </div>
    </div>
  );
}

/** Up to three small commands or fields stacked in one group column. */
export function RibbonStack({ children }: { children: ReactNode }) {
  return <div className="rb-stack">{children}</div>;
}

interface ButtonProps {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  size?: 'large' | 'small';
  disabled?: boolean;
  /** Toggle state; rendered as `aria-pressed` and the accent "on" style. */
  pressed?: boolean;
  /** The single green command of the ribbon. */
  primary?: boolean;
  title?: string;
}

/**
 * A ribbon command. The visible label doubles as the accessible name; small labels may be
 * hidden in narrow windows, so the name is also set explicitly.
 */
export function RibbonButton(props: ButtonProps) {
  const size = props.size ?? 'small';
  return (
    <button
      className={`rb-${size} ${props.primary ? 'rb-primary' : ''} ${props.pressed ? 'on' : ''}`}
      aria-label={props.label}
      aria-pressed={props.pressed}
      title={props.title ?? props.label}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.icon}
      <span className="rb-label">{props.label}</span>
    </button>
  );
}

export interface RibbonTab<Id extends string> {
  id: Id;
  label: string;
  /** Workflow position ("01"…); stage tabs announce it so the order stays audible. */
  index?: string;
  done?: boolean;
  disabled?: boolean;
}

interface RibbonProps<Id extends string> {
  /** Title row content: quick-access toolbar, document title, status. */
  title: ReactNode;
  tabs: RibbonTab<Id>[];
  active: Id;
  onTab: (id: Id) => void;
  collapsed: boolean;
  onCollapse: (collapsed: boolean) => void;
  /** Commands of the active tab. */
  children: ReactNode;
}

/** Office-style ribbon as one floating Liquid Glass pane. */
export function Ribbon<Id extends string>(props: RibbonProps<Id>) {
  return (
    <header className={`ribbon float-glass ${props.collapsed ? 'collapsed' : ''}`}>
      <div className="ribbon-titlebar">{props.title}</div>
      <div className="ribbon-tabs">
        <nav className="ribbon-tablist" aria-label="Arbeitsablauf">
          {props.tabs.map((tab) => (
            <button
              key={tab.id}
              className={`ribbon-tab ${props.active === tab.id ? 'active' : ''} ${tab.done ? 'done' : ''}`}
              aria-current={props.active === tab.id ? 'page' : undefined}
              disabled={tab.disabled}
              onClick={() => props.onTab(tab.id)}
              onDoubleClick={() => props.onCollapse(!props.collapsed)}
            >
              {tab.index && <span className="sr-only">{tab.index} </span>}
              {tab.done && (
                <span className="tab-check" aria-hidden="true">
                  ✓
                </span>
              )}
              {tab.label}
              {tab.done && <span className="sr-only"> · erledigt</span>}
            </button>
          ))}
        </nav>
        <span className="ribbon-spacer" />
        <button
          className="icon-button ribbon-collapse"
          aria-label={props.collapsed ? 'Menüband ausklappen' : 'Menüband einklappen'}
          title={props.collapsed ? 'Menüband ausklappen' : 'Menüband einklappen'}
          aria-expanded={!props.collapsed}
          onClick={() => props.onCollapse(!props.collapsed)}
        >
          {props.collapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
        </button>
      </div>
      {!props.collapsed && (
        <div className="ribbon-body" role="toolbar" aria-label="Befehle">
          {props.children}
        </div>
      )}
    </header>
  );
}
