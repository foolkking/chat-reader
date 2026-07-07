import { Suspense } from "react";
import { SearchPage } from "../../features/search/search-page";

export default function SearchRoute() {
  return (
    <Suspense fallback={null}>
      <SearchPage />
    </Suspense>
  );
}
