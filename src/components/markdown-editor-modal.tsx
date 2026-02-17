"use client";

import { useState, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { MarkdownContent } from "@/components/markdown-content";

export interface MarkdownEditorModalProps {
  open: boolean;
  title: string;
  description: string;
  initialValue: string;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (value: string) => Promise<void>;
}

const applyTabIndent = (
  event: KeyboardEvent<HTMLTextAreaElement>,
  value: string,
  setValue: (nextValue: string) => void,
): void => {
  if (event.key !== "Tab") {
    return;
  }

  event.preventDefault();
  const textarea = event.currentTarget;
  const { selectionStart, selectionEnd } = textarea;
  const nextValue = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
  setValue(nextValue);

  requestAnimationFrame(() => {
    textarea.selectionStart = selectionStart + 2;
    textarea.selectionEnd = selectionStart + 2;
  });
};

export function MarkdownEditorModal({
  open,
  title,
  description,
  initialValue,
  saving,
  onOpenChange,
  onSave,
}: MarkdownEditorModalProps) {
  const [value, setValue] = useState(() => initialValue);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="top" className="h-[90vh] w-[100vw] max-w-none p-0" showCloseButton={false}>
        <SheetHeader className="border-b border-border px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <SheetTitle>{title}</SheetTitle>
              <SheetDescription>{description}</SheetDescription>
            </div>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        </SheetHeader>

        <div className="grid flex-1 gap-4 overflow-hidden p-6 lg:grid-cols-2">
          <div className="flex h-full flex-col gap-2 overflow-hidden">
            <h4 className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Raw Markdown</h4>
            <textarea
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => applyTabIndent(event, value, setValue)}
              className="border-input focus-visible:border-ring focus-visible:ring-ring/50 min-h-0 w-full flex-1 resize-none rounded-md border bg-background p-3 font-mono text-sm leading-6 outline-none focus-visible:ring-[3px]"
            />
          </div>

          <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden rounded-md border border-border bg-muted/20 p-3">
            <h4 className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Live Preview</h4>
            <div className="min-h-0 flex-1 overflow-auto">
              <MarkdownContent content={value || "_(empty)_"} />
            </div>
          </div>
        </div>

        <SheetFooter className="border-t border-border px-6 py-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={saving}
            onClick={async () => {
              await onSave(value);
            }}
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
