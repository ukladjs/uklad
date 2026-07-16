import { ObjectView, themeOneDark, themeQuietLight, extendTheme, ResolverFn } from 'react-obj-view';
import { useTheme } from '../../contexts/ThemeContext';

interface Patch {
    op: 'replace' | 'add' | 'remove';
    path: (string | number)[];
    value?: any;
}

interface DiffViewerProps {
    patches?: Patch[];
    reversePatches?: Patch[];
}

interface DiffLine {
    type: 'add' | 'remove';
    path: string;
    value: any;
}

const darkTheme = extendTheme(themeOneDark, {
    background: 'transparent',
});

const lightTheme = extendTheme(themeQuietLight, {
    background: 'transparent',
});

// Custom resolver for Set - renders as plain array of values
const setResolver: ResolverFn<Set<any>> = (set, _cb, next) => {
    // Delegate to array renderer - shows values directly without key/value wrapper
    next(Array.from(set));
};

// Custom resolver for Map - renders as plain array of [key, value] entries
const mapResolver: ResolverFn<Map<any, any>> = (map, _cb, next) => {
    // Delegate to array renderer - shows entries as [key, value] tuples
    next(Array.from(map.entries()));
};

const customResolver = new Map<any, ResolverFn>([
    [Set, setResolver],
    [Map, mapResolver],
]);

function patchesToDiffLines(patches: Patch[], reversePatches?: Patch[]): DiffLine[] {
    const lines: DiffLine[] = [];

    // Create a map of reverse patches by path for quick lookup
    const reversePatchesMap = new Map<string, Patch>();
    if (reversePatches) {
        reversePatches.forEach((patch) => {
            const pathStr = patch.path.map(segment =>
                typeof segment === 'number' ? `[${segment}]` : `.${segment}`
            ).join('').replace(/^\./, '');
            reversePatchesMap.set(pathStr, patch);
        });
    }

    patches.forEach((patch) => {
        const pathStr = patch.path.map(segment =>
            typeof segment === 'number' ? `[${segment}]` : `.${segment}`
        ).join('').replace(/^\./, '');

        if (patch.op === 'add') {
            lines.push({ type: 'add', path: pathStr, value: patch.value });
        } else if (patch.op === 'replace') {
            // Use the previous value from reversePatches if available
            const reversePatch = reversePatchesMap.get(pathStr);
            lines.push({ type: 'remove', path: pathStr, value: reversePatch?.value });
            lines.push({ type: 'add', path: pathStr, value: patch.value });
        } else if (patch.op === 'remove') {
            // Use the removed value from reversePatches if available
            const reversePatch = reversePatchesMap.get(pathStr);
            lines.push({ type: 'remove', path: pathStr, value: reversePatch?.value });
        }
    });

    return lines;
}

function ValueRenderer({ value, theme }: { value: any; theme: 'light' | 'dark' }) {
    // For primitive values (string, number, boolean) or null/undefined, render as plain text
    if (value === null || value === undefined ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean') {
        const displayValue = value === null ? 'null' :
            value === undefined ? 'undefined' :
                typeof value === 'string' ? `"${value}"` :
                    String(value);
        return <span className="font-mono text-sm">{displayValue}</span>;
    }
    // For objects and arrays, use ObjectView with compact settings
    const objectTheme = extendTheme(theme === 'dark' ? darkTheme : lightTheme, {
        fontSize: '12px',
        padding: '2px 0'
    });

    return (
        <ObjectView
            valueGetter={() => value}
            expandLevel={1}
            name={""}
            highlightUpdate={false}
            stickyPathHeaders={false}
            objectGroupSize={100}
            arrayGroupSize={100}
            style={objectTheme}
            resolver={customResolver}
        />
    );
}

export function DiffViewer({ patches, reversePatches }: DiffViewerProps) {
    const { theme } = useTheme();
    const diffLines = patchesToDiffLines(patches ?? [], reversePatches ?? []);

    if (diffLines.length > 0) {
        return (
            <div className="p-2">
                {diffLines.map((line, index) => {
                    const isAddition = line.type === 'add';
                    const textColor = isAddition ? 'text-green-400' : 'text-red-400';
                    const symbol = isAddition ? '+' : '-';

                    const backgroundColor = isAddition ? 'bg-green-500/10' : 'bg-red-500/10';

                    return (
                        <div key={index} className={`flex items-center gap-2 py-1 px-2 rounded ${textColor} ${backgroundColor}`}>
                            <span className="font-mono text-sm flex-shrink-0">{symbol}</span>
                            <span className="font-mono text-sm flex-shrink-0">{line.path}:</span>
                            <div className="flex-1 min-w-0">
                                <ValueRenderer value={line.value} theme={theme} />
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    }
}
