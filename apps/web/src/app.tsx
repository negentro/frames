import { createBrowserRouter, RouterProvider } from "react-router";
import { HomePage } from "./pages/home";
import { ProjectPage } from "./pages/project";
import { NotFoundPage } from "./pages/not-found";

const router = createBrowserRouter([
  {
    path: "/",
    element: <HomePage />,
  },
  {
    path: "/project/:id",
    element: <ProjectPage />,
  },
  {
    path: "*",
    element: <NotFoundPage />,
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
