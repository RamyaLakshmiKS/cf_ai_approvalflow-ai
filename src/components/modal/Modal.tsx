import { X } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/button/Button";
import { Card } from "@/components/card/Card";
import useClickOutside from "@/hooks/useClickOutside";
import { cn } from "@/lib/utils";

type ModalProps = {
  className?: string;
  children: React.ReactNode;
  clickOutsideToClose?: boolean;
  isOpen: boolean;
  onClose: () => void;
};

export const Modal = ({
  className,
  children,
  clickOutsideToClose = false,
  isOpen,
  onClose
}: ModalProps) => {
  const modalRef = clickOutsideToClose
    ? // biome-ignore lint/correctness/useHookAtTopLevel: todo
      useClickOutside(onClose)
    : // biome-ignore lint/correctness/useHookAtTopLevel: todo
      useRef<HTMLDivElement>(null);

  // Track if we've already focused on this modal open
  const hasFocusedRef = useRef(false);

  // Stop site overflow when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Reset focus tracking when modal closes
  useEffect(() => {
    if (!isOpen) {
      hasFocusedRef.current = false;
    }
  }, [isOpen]);

  // Tab focus and initial focus - only run once when modal opens
  // biome-ignore lint/correctness/useExhaustiveDependencies: modalRef.current is intentionally captured fresh each time isOpen changes
  useEffect(() => {
    const modalElement = modalRef.current;
    if (!isOpen || !modalElement) return;

    // Only focus the first element once when modal opens
    if (!hasFocusedRef.current) {
      const focusableElements = modalElement.querySelectorAll(
        'a, button, input, textarea, select, details, [tabindex]:not([tabindex="-1"])'
      ) as NodeListOf<HTMLElement>;

      const firstElement = focusableElements[0];
      if (firstElement) {
        firstElement.focus();
        hasFocusedRef.current = true;
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        // Get fresh list of focusable elements for tab trapping
        const currentFocusableElements = modalElement?.querySelectorAll(
          'a, button, input, textarea, select, details, [tabindex]:not([tabindex="-1"])'
        ) as NodeListOf<HTMLElement> | undefined;

        if (!currentFocusableElements || currentFocusableElements.length === 0)
          return;

        const currentFirstElement = currentFocusableElements[0];
        const currentLastElement =
          currentFocusableElements[currentFocusableElements.length - 1];

        if (e.shiftKey) {
          // Shift + Tab moves focus backward
          if (document.activeElement === currentFirstElement) {
            e.preventDefault();
            currentLastElement.focus();
          }
        } else {
          // Tab moves focus forward
          if (document.activeElement === currentLastElement) {
            e.preventDefault();
            currentFirstElement.focus();
          }
        }
      }
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed top-0 left-0 z-50 flex h-screen w-full items-center justify-center bg-transparent p-6">
      <div className="fade fixed top-0 left-0 h-full w-full bg-black/5 backdrop-blur-[2px]" />

      <Card
        className={cn("reveal reveal-sm relative z-50 max-w-md", className)}
        ref={modalRef}
        tabIndex={-1}
      >
        {children}

        <Button
          aria-label="Close Modal"
          shape="square"
          className="absolute top-2 right-2"
          onClick={onClose}
          variant="ghost"
        >
          <X size={16} />
        </Button>
      </Card>
    </div>
  );
};
