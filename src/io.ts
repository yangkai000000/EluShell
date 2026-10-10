export type DeviceIO = {
  name: string;
  readBytes: number;
  writeBytes: number;
  operations: number;
  busyMs: number;
  readRate: number;
  writeRate: number;
  iops: number;
  utilization: number;
};
export function diskRates(raw: string, previousRaw = '', seconds = 0): DeviceIO[] {
  const parse = (text: string) =>
    text.split('\n').flatMap((line) => {
      const n = line.trim().split(/\s+/);
      if (
        n.length < 14 ||
        !/^(sd[a-z]+|vd[a-z]+|xvd[a-z]+|nvme\d+n\d+|mmcblk\d+|dm-\d+|md\d+)$/.test(n[2])
      )
        return [];
      return [
        {
          name: n[2],
          readBytes: Number(n[5]) * 512,
          writeBytes: Number(n[9]) * 512,
          operations: Number(n[3]) + Number(n[7]),
          busyMs: Number(n[12]),
        },
      ];
    });
  const previous = parse(previousRaw);
  return parse(raw).map((now) => {
    const old = previous.find((x) => x.name === now.name);
    const rate = (key: 'readBytes' | 'writeBytes' | 'operations' | 'busyMs') =>
      old && seconds > 0 ? Math.max(0, (now[key] - old[key]) / seconds) : 0;
    return {
      ...now,
      readRate: rate('readBytes'),
      writeRate: rate('writeBytes'),
      iops: rate('operations'),
      utilization: Math.min(100, rate('busyMs') / 10),
    };
  });
}
