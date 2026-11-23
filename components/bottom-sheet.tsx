'use client';

import * as Dialog from '@radix-ui/react-dialog';
import {X} from 'lucide-react';
import {useRef, type ReactNode, type RefObject} from 'react';
import './bottom-sheet.css';

type BottomSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  children: ReactNode;
  description?: ReactNode;
  desktopVariant?: 'dialog' | 'drawer';
  className?: string;
  scopeClassName?: string;
  busy?: boolean;
  hideHeader?: boolean;
  hideClose?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
  closeLabel?: string;
  role?: 'dialog' | 'alertdialog';
};

/** Accessible modal used by the notification tray: a centered dialog or a right-hand panel. */
export function BottomSheet({open, onOpenChange, title, children, description, desktopVariant = 'dialog', className, scopeClassName, busy = false, hideHeader = false, hideClose = false, initialFocusRef, returnFocusRef, closeLabel = 'Close', role}: BottomSheetProps) {
  const previous = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={next => { if (next || !busy) onOpenChange(next); }}>
      <Dialog.Portal>
        <div className={'portal-sheet-scope' + (scopeClassName ? ' ' + scopeClassName : '')}>
          <Dialog.Overlay className="portal-sheet-overlay" data-lenis-prevent />
          <Dialog.Content className={'portal-sheet' + (className ? ' ' + className : '')}
            {...(role ? {role} : {})} aria-modal="true" data-desktop={desktopVariant} data-lenis-prevent
            {...(description == null ? {'aria-describedby': undefined} : {})}
            onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}
            onPointerDownOutside={event => { if (busy) event.preventDefault(); }}
            onOpenAutoFocus={event => {
              previous.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
              if (initialFocusRef?.current) { event.preventDefault(); initialFocusRef.current.focus({preventScroll: true}); }
            }}
            onCloseAutoFocus={event => {
              const target = returnFocusRef?.current ?? previous.current;
              if (target?.isConnected) { event.preventDefault(); target.focus({preventScroll: true}); }
            }}>
            <div className={hideHeader ? 'portal-sheet-sr-only' : 'portal-sheet-header'}>
              <div>
                <Dialog.Title className="portal-sheet-title">{title}</Dialog.Title>
                {description != null && <Dialog.Description className="portal-sheet-description">{description}</Dialog.Description>}
              </div>
              {!hideHeader && !hideClose && <Dialog.Close className="portal-sheet-close" type="button" aria-label={closeLabel} disabled={busy}><X size={20} aria-hidden="true" /></Dialog.Close>}
            </div>
            <div className="portal-sheet-body">{children}</div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}