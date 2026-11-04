/** Mirrors `ProjectCanvasState` in backend/app/routers/project_canvas.py. */
export interface ProjectCanvasState {
  description: string
  features: string[]
  user_stories: UserStory[]
}

export interface UserStory {
  id: string
  title: string
  description: string
}
