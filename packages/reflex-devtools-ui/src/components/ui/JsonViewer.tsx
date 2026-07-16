import { useRef } from 'react';
import { ObjectView, ObjectViewHandle, themeOneDark, themeQuietLight, extendTheme, ResolverFn } from 'react-obj-view';
import "react-obj-view/dist/react-obj-view.css";
import { useTheme } from '../../contexts/ThemeContext';
import { SearchBox } from './SearchBox';
import { DEFAULT_ACTION } from './jsonViewerActions';

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

/**
 * JsonViewer component with built-in copy action using book icons.
 * The copy button shows a book icon that changes to a book with checkmark during copying.
 */
export function JsonViewer({ src, name, expandLevel }: { src: any; name: string; expandLevel?: number; }) {
    const { theme } = useTheme();
    const objViewRef = useRef<ObjectViewHandle>(undefined);

    return (
        <div className="relative h-full">
            <div className="absolute top-1 right-1 z-101">
                <SearchBox objViewRef={objViewRef} />
            </div>
            <div className="h-full overflow-auto">
                <ObjectView
                    ref={objViewRef}
                    valueGetter={() => src}
                    name={name}
                    expandLevel={expandLevel ?? 1}
                    overscan={200}
                    lineHeight={20}
                    showLineNumbers={false}
                    objectGroupSize={100}
                    arrayGroupSize={100}
                    highlightUpdate={true}
                    style={theme === 'dark' ? darkTheme : lightTheme}
                    resolver={customResolver}
                    customActions={DEFAULT_ACTION}
                />
            </div>
        </div>
    );
}