import { Tabs } from '@base-ui/react/tabs';
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
          className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium uppercase tracking-wider text-text-dim transition-colors hover:text-text-main aria-selected:border-b-2 aria-selected:border-accent aria-selected:text-accent"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          Analysis
        </Tabs.Tab>
        {showTherapy && (
          <Tabs.Tab
            value="therapy"
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium uppercase tracking-wider text-text-dim transition-colors hover:text-text-main aria-selected:border-b-2 aria-selected:border-accent aria-selected:text-accent"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2z" />
            </svg>
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
