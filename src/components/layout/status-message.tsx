import type { ReactNode } from "react";
import { Container } from "@/components/ui/container";
import { CursorBlock } from "@/components/ui/cursor-block";

export type StatusMessageProps = { title: string; description: string; children: ReactNode };

// Pure presentation shared by app/not-found.tsx (Server) and (shop)/error.tsx (Client): no hooks, no data, so it
// renders identically on either side. Children are the action area; callers give each action `w-full md:w-auto`.
export const StatusMessage = ({ title, description, children }: StatusMessageProps) => (
  <Container className="flex flex-col items-start gap-6 pt-16 pb-20 md:gap-8 md:pt-32 md:pb-40">
    <CursorBlock className="size-8" />
    <h1 className="text-4xl font-bold tracking-tight text-balance md:text-5xl">{title}</h1>
    <p className="max-w-xl text-lg text-muted-foreground md:text-xl">{description}</p>
    <div className="flex w-full flex-col gap-4 md:w-auto md:flex-row">{children}</div>
  </Container>
);
