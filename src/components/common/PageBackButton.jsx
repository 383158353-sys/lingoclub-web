import React from "react";
import { ArrowLeft } from "lucide-react";

export default function PageBackButton({ onClick, children = "返回", className = "", ...props }) {
  return <button type="button" onClick={onClick} className={`inline-flex min-h-8 items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-copper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper/50 ${className}`} {...props}>
    <ArrowLeft size={16} strokeWidth={1.8} aria-hidden="true" />{children}
  </button>;
}
