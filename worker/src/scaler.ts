const JOBS_PER_MACHINE = Number(process.env.JOBS_PER_MACHINE ?? 5);
const MIN_MACHINES = Number(process.env.MIN_MACHINES ?? 1);
const MAX_MACHINES = Number(process.env.MAX_MACHINES ?? 5);
const SCALE_INTERVAL_MS = 30_000;

interface FlyMachine {
  id: string;
  state: string;
}

async function flyRequest(path: string, method = 'GET', body?: unknown): Promise<unknown> {
  const token = process.env.FLY_API_TOKEN;
  const app = process.env.FLY_APP_NAME;
  if (!token || !app) throw new Error('FLY_API_TOKEN and FLY_APP_NAME must be set');

  const res = await fetch(`https://api.machines.dev/v1/apps/${app}/machines${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) throw new Error(`Fly API ${method} ${path}: ${res.status} ${await res.text()}`);
  return method === 'GET' ? res.json() : null;
}

async function getRunningMachines(): Promise<FlyMachine[]> {
  const machines = (await flyRequest('')) as FlyMachine[];
  return machines.filter((m) => m.state === 'started');
}

export function startAutoscaler(getQueueDepth: () => Promise<number>): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      const depth = await getQueueDepth();
      const desired = Math.min(
        MAX_MACHINES,
        Math.max(MIN_MACHINES, Math.ceil(depth / JOBS_PER_MACHINE))
      );

      const running = await getRunningMachines();
      const runningCount = running.length;

      if (desired > runningCount) {
        const toStart = desired - runningCount;
        console.log(`[scaler] depth=${depth}, starting ${toStart} machine(s)`);
        for (let i = 0; i < toStart; i++) {
          await flyRequest('', 'POST', { config: {} });
        }
      } else if (desired < runningCount) {
        const toStop = runningCount - desired;
        console.log(`[scaler] depth=${depth}, stopping ${toStop} machine(s)`);
        const idle = running.slice(runningCount - toStop);
        for (const m of idle) {
          await flyRequest(`/${m.id}/stop`, 'POST');
        }
      }
    } catch (err) {
      console.error('[scaler] Error:', (err as Error).message);
    }
  }, SCALE_INTERVAL_MS);
}
