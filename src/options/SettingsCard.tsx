// A card on the settings page, after Claude in Chrome's: a thin border and no shadow, generous padding, and an optional
// title and description above the card's contents.
import { Children, cloneElement, isValidElement, useId } from 'react';
import type { ReactNode } from 'react';

export function SettingsCard({
  title,
  description,
  children,
  className = '',
}: {
  title?: string;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className="rounded-xl border border-nb-border bg-nb-bg p-5 sm:px-8 sm:py-7">
      {title ? (
        <div className={`flex flex-col gap-1.5 ${children ? 'mb-6' : ''}`}>
          <h3 className="text-xl font-semibold">{title}</h3>
          {description ? <p className="text-[15px] leading-relaxed text-nb-muted">{description}</p> : null}
        </div>
      ) : null}
      {children ? <div className={className}>{children}</div> : null}
    </section>
  );
}

/**
 * One setting, as Claude in Chrome lays it out: its name with a muted line under it at the left, the control at the
 * right. Below 640 px the control goes under the text. The control carries its own `aria-label`; the row is a group
 * named by its text, and each control is described by the row's description, so a screen reader reads it on the
 * control as well as on entering the group.
 */
export function SettingsRow({
  label,
  description,
  icon,
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  /** A mark before the name, such as the microphone's green check. */
  icon?: ReactNode;
  children?: ReactNode;
}) {
  const id = useId();
  return (
    <div
      role="group"
      aria-labelledby={`${id}-label`}
      aria-describedby={description ? `${id}-description` : undefined}
      className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
      <div className="flex min-w-0 gap-3">
        {icon ? <div className="pt-0.5">{icon}</div> : null}
        <div className="flex min-w-0 flex-col gap-1">
          <span id={`${id}-label`} className="text-base">
            {label}
          </span>
          {description ? (
            <span id={`${id}-description`} className="text-sm leading-relaxed text-nb-muted">
              {description}
            </span>
          ) : null}
        </div>
      </div>
      {children ? (
        <div className="flex min-w-0 max-w-full shrink-0 flex-wrap items-center gap-2">
          {description
            ? Children.map(children, child =>
                isValidElement<{ 'aria-describedby'?: string }>(child)
                  ? cloneElement(child, { 'aria-describedby': `${id}-description` })
                  : child,
              )
            : children}
        </div>
      ) : null}
    </div>
  );
}
