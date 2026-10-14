import { useEffect, useState } from "react";

import { loadProject, onProjectChange, type Project } from "../engine/project";

/** The open file's project, kept current as you or an agent change it. */
export function useProject(id: string): Project {
  const [project, setProject] = useState(() => loadProject(id));
  useEffect(() => {
    setProject(loadProject(id));
    return onProjectChange((changed) => {
      if (changed === id) setProject(loadProject(id));
    });
  }, [id]);
  return project;
}
