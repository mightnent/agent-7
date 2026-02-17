"use client";

import ReactMarkdown from "react-markdown";

import { cn } from "@/lib/utils";

export interface MarkdownContentProps {
  content: string;
  className?: string;
}

export function MarkdownContent({ content, className }: MarkdownContentProps) {
  return (
    <div className={cn("markdown-content", className)}>
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}
