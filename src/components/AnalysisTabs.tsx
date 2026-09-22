import { Tabs } from '@base-ui/react/tabs';
import { Waveform, Star } from '@phosphor-icons/react';
import type { TherapyReport } from '../app/types';
import { TherapyPanel } from './TherapyPanel';

type Props = {
  therapyReport: TherapyReport | null;
  children: React.ReactNode;
};

export function AnalysisTabs({ therapyReport, children }: Props) {
  const showTherapy = therapyReport !== null;

  return (
    <Tabs.Root defaultValue={showTherapy ? 'therapy' : 'analysis'}>
      <Tabs.List className="mb-4 flex gap-0 border-b border-border">
        <Tabs.Tab
          value="analysis"
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium uppercase tracking-wider text-text-dim transition-colors hover:text-text-main aria-selected:border-b-2 aria-selected:border-accent aria-selected:text-accent"
        >
          <Waveform className="size-3.5" weight="bold" />
          Analysis
        </Tabs.Tab>
        {showTherapy && (
          <Tabs.Tab
            value="therapy"
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium uppercase tracking-wider text-text-dim transition-colors hover:text-text-main aria-selected:border-b-2 aria-selected:border-accent aria-selected:text-accent"
          >
            <Star className="size-3.5" weight="bold" />
            Therapy Validation
          </Tabs.Tab>
        )}
      </Tabs.List>

      <Tabs.Panel value="analysis">
        {children}
      </Tabs.Panel>

      {showTherapy && (
        <Tabs.Panel value="therapy">
          <TherapyPanel report={therapyReport} />
        </Tabs.Panel>
      )}
    </Tabs.Root>
  );
}
