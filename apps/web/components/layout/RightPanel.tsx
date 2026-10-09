'use client';

import type { AnalysisResult } from '@readme-intel/core';
import { Activity, Braces, Layers, Terminal } from 'lucide-react';
import { ProjectCard } from '@/components/intelligence/ProjectCard';
import { HealthCard } from '@/components/intelligence/HealthCard';
import { InstallCard } from '@/components/intelligence/InstallCard';
import { CommandsCard } from '@/components/intelligence/CommandsCard';
import { EnvCard } from '@/components/intelligence/EnvCard';
import { TechStackCard } from '@/components/intelligence/TechStackCard';
import { FeaturesCard } from '@/components/intelligence/FeaturesCard';
import { ApiCard } from '@/components/intelligence/ApiCard';
import { DeployCard } from '@/components/intelligence/DeployCard';
import { LinksCard } from '@/components/intelligence/LinksCard';
import {
  RealityCheckCard,
  ReadinessCard,
  type RealityState,
} from '@/components/intelligence/RealityCheck';

interface RightPanelProps {
  analysis: AnalysisResult;
  reality: RealityState;
  onRunReality: () => void;
  variant?: 'rail' | 'overview';
}

/** Intelligence cards in either the compact reader rail or full-screen overview. */
export function RightPanel({ analysis, reality, onRunReality, variant = 'rail' }: RightPanelProps) {
  const i = analysis.intelligence;

  if (variant === 'overview') {
    return (
      <div
        className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4"
        data-testid="intelligence-overview"
      >
        <div className="col-span-full grid grid-cols-2 gap-2 sm:grid-cols-4">
          <OverviewStat
            icon={Terminal}
            label="Commands"
            value={i.commands.length}
            hint="copy-ready"
          />
          <OverviewStat
            icon={Braces}
            label="Environment"
            value={i.envVars.length}
            hint="variables found"
          />
          <OverviewStat
            icon={Layers}
            label="Tech signals"
            value={i.techStack.length}
            hint="evidence-backed"
          />
          <OverviewStat
            icon={Activity}
            label="Health"
            value={analysis.health.score}
            hint="out of 100"
          />
        </div>

        <OverviewSectionLabel text="Project signals" />
        <div className="xl:col-span-2">
          <ProjectCard intel={i} source={analysis.source} />
        </div>
        <div>
          <HealthCard health={analysis.health} />
        </div>
        <div>
          <InstallCard intel={i} />
        </div>

        <OverviewSectionLabel text="Extracted evidence" />
        <div className="xl:col-span-2">
          <CommandsCard commands={i.commands} />
        </div>
        <div className="xl:col-span-2">
          <EnvCard envVars={i.envVars} />
        </div>
        <div className="xl:col-span-2">
          <TechStackCard tech={i.techStack} />
        </div>
        <div>
          <FeaturesCard features={i.features} />
        </div>
        <div>
          <ApiCard api={i.api} />
        </div>
        <div>
          <DeployCard deployment={i.deployment} />
        </div>
        <div className="xl:col-span-2">
          <LinksCard links={i.links} />
        </div>

        <OverviewSectionLabel text="Repository verification" />
        <div className="xl:col-span-2">
          <RealityCheckCard
            state={reality}
            available={analysis.source.kind === 'github'}
            onRun={onRunReality}
          />
        </div>
        <div className="xl:col-span-2">
          <ReadinessCard state={reality} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="intelligence">
      <ProjectCard intel={i} source={analysis.source} />
      <HealthCard health={analysis.health} />
      <ReadinessCard state={reality} />
      <RealityCheckCard
        state={reality}
        available={analysis.source.kind === 'github'}
        onRun={onRunReality}
      />
      <InstallCard intel={i} />
      <CommandsCard commands={i.commands} />
      <EnvCard envVars={i.envVars} />
      <TechStackCard tech={i.techStack} />
      <FeaturesCard features={i.features} />
      <ApiCard api={i.api} />
      <DeployCard deployment={i.deployment} />
      <LinksCard links={i.links} />
    </div>
  );
}

function OverviewSectionLabel({ text }: { text: string }) {
  return (
    <div className="col-span-full flex items-center gap-3 pt-2">
      <p className="eyebrow">{text}</p>
      <span className="h-px flex-1 bg-border" aria-hidden />
    </div>
  );
}

function OverviewStat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Terminal;
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <div className="rounded-card border border-border bg-surface px-3 py-3 shadow-[0_1px_0_color-mix(in_srgb,var(--text)_4%,transparent)]">
      <div className="flex items-center gap-2 text-fg-2">
        <Icon className="h-3.5 w-3.5 text-accent" aria-hidden />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="mt-2 font-mono text-2xl font-semibold tracking-[-0.05em]">{value}</p>
      <p className="mt-0.5 text-[11px] text-fg-2">{hint}</p>
    </div>
  );
}
