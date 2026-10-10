const groups = [
  ['所有者', 6],
  ['用户组', 3],
  ['其他用户', 0],
] as const;
const rights = [
  ['读取', 4],
  ['写入', 2],
  ['执行', 1],
] as const;
export default function PermissionEditor({
  value,
  change,
  directory,
}: {
  value: string;
  change: (value: string) => void;
  directory: boolean;
}) {
  const valid = /^[0-7]{3,4}$/.test(value),
    mode = valid ? parseInt(value, 8) : 0;
  return (
    <div className="permission-editor">
      <table aria-label="文件权限勾选设置">
        <thead>
          <tr>
            <th>适用用户</th>
            {rights.map(([name]) => (
              <th key={name}>{name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map(([group, shift]) => (
            <tr key={group}>
              <th scope="row">{group}</th>
              {rights.map(([name, bit]) => (
                <td key={name}>
                  <input
                    type="checkbox"
                    aria-label={group + name}
                    disabled={!valid}
                    checked={Boolean(mode & (bit << shift))}
                    onChange={(e) =>
                      change(
                        (e.target.checked ? mode | (bit << shift) : mode & ~(bit << shift))
                          .toString(8)
                          .padStart(value.length, '0'),
                      )
                    }
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <small>
        {directory
          ? '读取：列出目录；写入：增删条目；执行：进入目录。'
          : '读取：查看内容；写入：修改内容；执行：运行文件。'}
      </small>
      {!valid && <small>输入完整的 3 或 4 位权限后即可勾选。</small>}
    </div>
  );
}
