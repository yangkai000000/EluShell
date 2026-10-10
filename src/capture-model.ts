import { useEffect, useRef, useState } from 'react';
import { CaptureOptionsSchema, type CaptureJob, type CaptureOptions } from './capture-shared';
export function useCaptures(enabled: boolean) {
  const [jobs, setJobs] = useState<CaptureJob[]>([]);
  const [drafts, setDrafts] = useState<Record<string, CaptureOptions>>({});
  const [error, setError] = useState('');
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  useEffect(() => {
    if (!enabled) {
      setJobs([]);
      return;
    }
    let alive = true;
    const updates = new Map<string, CaptureJob>();
    const off = window.elu!.onCapture((job) => {
      updates.set(job.id, job);
      if (updates.size > 20) updates.delete(updates.keys().next().value!);
      setJobs((old) =>
        [job, ...old.filter((j) => j.id !== job.id)]
          .sort((a, b) => b.started - a.started)
          .slice(0, 20),
      );
    });
    void window
      .elu!.captureList()
      .then((list) => {
        if (alive)
          setJobs(
            [...new Map([...list, ...updates.values()].map((j) => [j.id, j])).values()]
              .sort((a, b) => b.started - a.started)
              .slice(0, 20),
          );
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
      off();
      updates.clear();
    };
  }, [enabled]);
  return {
    jobs,
    setJobs,
    error,
    setError,
    drafts,
    setDraft: (id: string, value: CaptureOptions) => setDrafts((d) => ({ ...d, [id]: value })),
    draft: (id: string) => drafts[id] || CaptureOptionsSchema.parse({}),
    release: (id: string) =>
      setDrafts((d) => {
        const next = { ...d };
        delete next[id];
        return next;
      }),
  };
}
export type CaptureModel = ReturnType<typeof useCaptures>;
