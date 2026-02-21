# App Router vs Pages Router Architecture

## Source: https://dev.to/shyam0118/app-router-vs-pages-router-in-nextjs-a-deep-practical-guide-341g

### Key Architectural Differences

**Pages Router (Legacy)**
- **File-based routing**: Every file in pages/ directory becomes a route
- **Client components by default**: All components render on client-side first
- **Data fetching**: Uses getServerSideProps, getStaticProps, getStaticPaths
- **Layouts**: Handled via _app.js and _document.js
- **API Routes**: pages/api/ directory structure
- **Bundle size**: Larger client bundles
- **Mental model**: Simple file-to-route mapping

**App Router (Modern - Next.js 13+)**
- **Folder-based routing**: Folders define routes, special files define UI
- **Server components by default**: Components render on server first
- **Data fetching**: Direct async/await in components using fetch()
- **Layouts**: Nested layouts with layout.js files that persist across routes
- **Loading states**: Built-in loading.js files
- **Error boundaries**: Built-in error.js files
- **Bundle size**: Smaller client bundles due to server components
- **Route organization**: Route groups with (folder) syntax for organization

### Performance Implications

**Pages Router:**
- Larger JavaScript bundles sent to client
- All components hydrate on client-side
- Manual layout recreation on route changes
- Client-side data fetching requires additional API calls

**App Router:**
- Smaller JavaScript bundles (server components don't ship JS)
- Progressive enhancement with server-first rendering
- Persistent layouts across route changes
- Server-side data fetching reduces client-server roundtrips
- Streaming and Suspense for better perceived performance

### Migration Considerations

**When to use Pages Router:**
- Existing stable applications
- Small to medium projects
- Teams familiar with traditional React patterns
- Need for extensive third-party library compatibility

**When to use App Router:**
- New projects (recommended for Next.js 13+)
- Complex applications requiring nested layouts
- Performance-critical applications
- Applications requiring streaming and Suspense
- Projects leveraging modern React patterns
