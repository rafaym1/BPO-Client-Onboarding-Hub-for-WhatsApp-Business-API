"use client";

import { ExternalLink } from "lucide-react";
import { useConfig } from "@/components/providers";

/** Jira issue key: a real link when Jira is live, plain text (no dead link) when it is mocked. */
export function JiraKey({ issueKey, url, className }: { issueKey: string; url: string | null; className?: string }) {
  const config = useConfig();
  if (!url || config?.mock.jira !== false) {
    return <span className={className} title="Mock Jira issue — connect Jira credentials to get a live link">{issueKey}</span>;
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className={`inline-flex items-center gap-1 hover:underline ${className ?? ""}`}>
      {issueKey} <ExternalLink className="h-3 w-3" />
    </a>
  );
}
