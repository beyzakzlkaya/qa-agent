"use client";

import { useRouter } from "next/navigation";
import { PromptEditor } from "@/components/runner/PromptEditor";
import { ArrowLeft } from "lucide-react";

export default function PromptPage() {
  const router = useRouter();
  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => router.back()}
          className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h2 className="text-xl font-semibold text-foreground">Prompt Editör</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Page Agent'a göndermek için prompt oluştur
          </p>
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg p-5">
        <PromptEditor />
      </div>
    </div>
  );
}
