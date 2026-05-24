"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export type ActivityEventType = "thinking" | "executing" | "error" | "status";

export interface ActivityEvent {
  id: number;
  type: ActivityEventType;
  message: string;
  timestamp: string;
}

interface ActivityLogProps {
  events: ActivityEvent[];
}

function EventIcon({ type }: { type: ActivityEventType }) {
  if (type === "thinking")
    return <span className="shrink-0 text-muted-foreground leading-none">💭</span>;
  if (type === "executing")
    return <span className="shrink-0 text-foreground/80 leading-none">▶</span>;
  if (type === "error")
    return <span className="shrink-0 text-destructive leading-none">✗</span>;
  return <span className="shrink-0 text-primary leading-none">ℹ</span>;
}

function EventRow({ event }: { event: ActivityEvent }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 px-3 py-1.5 rounded-md text-xs",
        event.type === "thinking" && "text-muted-foreground",
        event.type === "executing" && "text-foreground/85",
        event.type === "error" && "text-destructive bg-destructive/5",
        event.type === "status" && "text-primary"
      )}
    >
      <EventIcon type={event.type} />
      <span className="flex-1 leading-relaxed whitespace-pre-wrap break-words font-mono">
        {event.message}
      </span>
      <span className="shrink-0 text-muted-foreground/50 text-[10px] mt-0.5">
        {new Date(event.timestamp).toLocaleTimeString("tr-TR", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })}
      </span>
    </div>
  );
}

export function ActivityLog({ events }: ActivityLogProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  return (
    <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
      {events.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
          <div className="w-5 h-5 rounded-full border-2 border-muted border-t-muted-foreground animate-spin" />
          <span className="text-xs">Agent aktivitesi bekleniyor...</span>
        </div>
      ) : (
        events.map((event) => <EventRow key={event.id} event={event} />)
      )}
      <div ref={bottomRef} />
    </div>
  );
}
