// Grip To-Do App - Frontend JavaScript (Supabase-backed)

class TodoApp {
    constructor() {
        this.todos = [];
        this.currentView = { type: "list", value: "inbox" };
        this.availableLists = ["inbox", "today"];
        this.availableAreas = ["personal", "work"];
        this.availablePriorities = ["not_set", "low", "medium", "high"];
        this.addTaskVisible = false;
        this.cacheElements();
        this.bindEvents();
        this.loadTodos();
    }

    cacheElements() {
        this.todoInput = document.getElementById("todoInput");
        this.addButton = document.getElementById("addBtn");
        this.addTaskToggle = document.getElementById("addTaskToggle");
        this.addTaskRow = document.getElementById("addTaskRow");
        this.areaSelect = document.getElementById("areaSelect");
        this.prioritySelect = document.getElementById("prioritySelect");
        this.todoList = document.getElementById("todoList");
        this.itemCount = document.getElementById("itemCount");
        this.clearCompletedButton = document.getElementById("clearCompleted");
        this.statusMessage = document.getElementById("statusMessage");
        this.activeListLabel = document.getElementById("activeListLabel");
        this.sidebarItems = Array.from(
            document.querySelectorAll(".sidebar-item")
        );
    }

    bindEvents() {
        // Add task toggle
        this.addTaskToggle.addEventListener("click", () =>
            this.toggleAddTask()
        );

        // Add task submit
        this.addButton.addEventListener("click", () => this.addTodo());
        this.todoInput.addEventListener("keypress", (event) => {
            if (event.key === "Enter") {
                this.addTodo();
            }
        });

        // Sidebar navigation
        this.sidebarItems.forEach((item) => {
            item.addEventListener("click", () => {
                if (item.dataset.list) {
                    this.setView({
                        type: "list",
                        value: item.dataset.list,
                    });
                } else if (item.dataset.view) {
                    this.setView({
                        type: "view",
                        value: item.dataset.view,
                    });
                } else if (item.dataset.areaFilter) {
                    this.setView({
                        type: "area",
                        value: item.dataset.areaFilter,
                    });
                }
            });
        });

        // Clear completed
        this.clearCompletedButton.addEventListener("click", () =>
            this.clearCompleted()
        );

        // Task list event delegation
        this.todoList.addEventListener("change", (event) => {
            if (event.target.classList.contains("todo-checkbox")) {
                const id = Number(event.target.dataset.id);
                this.toggleTodo(id);
            }
        });

        this.todoList.addEventListener("click", (event) => {
            const menuButton = event.target.closest(".menu-btn");
            if (menuButton) {
                event.stopPropagation();
                const item = menuButton.closest(".todo-item");
                if (item) {
                    this.toggleMenu(item, menuButton);
                }
                return;
            }

            const changeButton = event.target.closest(".change-list-btn");
            if (changeButton) {
                event.stopPropagation();
                const id = Number(changeButton.dataset.id);
                const targetList = changeButton.dataset.targetList;
                this.closeAllMenus();
                if (targetList) {
                    this.moveTodo(id, targetList);
                }
                return;
            }

            const areaButton = event.target.closest(".set-area-btn");
            if (areaButton) {
                event.stopPropagation();
                const id = Number(areaButton.dataset.id);
                const targetArea = areaButton.dataset.area;
                this.closeAllMenus();
                this.setArea(id, targetArea || null);
                return;
            }

            const priorityButton = event.target.closest(".set-priority-btn");
            if (priorityButton) {
                event.stopPropagation();
                const id = Number(priorityButton.dataset.id);
                const targetPriority = priorityButton.dataset.priority;
                this.closeAllMenus();
                this.setPriority(id, targetPriority || "not_set");
                return;
            }

            const deleteButton = event.target.closest(".delete-btn");
            if (deleteButton) {
                event.stopPropagation();
                const id = Number(deleteButton.dataset.id);
                this.closeAllMenus();
                this.deleteTodo(id);
            }
        });

        // Close menus on outside click
        document.addEventListener("click", (event) => {
            if (!event.target.closest(".todo-actions")) {
                this.closeAllMenus();
            }
        });

        // Escape to close menus and hide add-task row
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                this.closeAllMenus();
                this.hideAddTask();
            }
        });
    }

    // --- Add task toggle ---

    toggleAddTask() {
        this.addTaskVisible = !this.addTaskVisible;
        this.addTaskRow.hidden = !this.addTaskVisible;
        if (this.addTaskVisible) {
            this.todoInput.focus();
        }
    }

    hideAddTask() {
        this.addTaskVisible = false;
        this.addTaskRow.hidden = true;
    }

    // --- View management ---

    setView(view) {
        this.currentView = view;

        // Update sidebar active state
        this.sidebarItems.forEach((item) => {
            let isActive = false;
            if (view.type === "list" && item.dataset.list === view.value)
                isActive = true;
            if (view.type === "view" && item.dataset.view === view.value)
                isActive = true;
            if (
                view.type === "area" &&
                item.dataset.areaFilter === view.value
            )
                isActive = true;
            item.classList.toggle("active", isActive);
            item.setAttribute("aria-pressed", isActive.toString());
        });

        // Update header title
        this.activeListLabel.textContent = this.getViewLabel();
        this.renderTodos();
    }

    getViewLabel() {
        switch (this.currentView.type) {
            case "list":
                return this.currentView.value === "inbox"
                    ? "Inbox"
                    : "Today";
            case "view":
                return this.currentView.value === "all"
                    ? "All Tasks"
                    : "Completed";
            case "area":
                return (
                    this.currentView.value.charAt(0).toUpperCase() +
                    this.currentView.value.slice(1)
                );
            default:
                return "Inbox";
        }
    }

    // --- Normalization ---

    normalizeListName(listName) {
        if (!listName) {
            return null;
        }
        const normalized = listName.toString().trim().toLowerCase();
        if (!this.availableLists.includes(normalized)) {
            return null;
        }
        return normalized;
    }

    normalizeArea(area) {
        if (area === null || area === undefined) {
            return null;
        }
        const normalized = area.toString().trim().toLowerCase();
        if (!normalized) {
            return null;
        }
        if (!this.availableAreas.includes(normalized)) {
            return null;
        }
        return normalized;
    }

    normalizePriority(priority) {
        if (priority === null || priority === undefined) {
            return "not_set";
        }
        const normalized = priority
            .toString()
            .trim()
            .toLowerCase()
            .replace(/\s+/g, "_");
        if (!normalized) {
            return "not_set";
        }
        if (!this.availablePriorities.includes(normalized)) {
            return "not_set";
        }
        return normalized;
    }

    normalizeTodo(todo) {
        const normalizedList =
            this.normalizeListName(todo.list) || this.availableLists[0];
        const normalizedArea = this.normalizeArea(todo.area);
        const normalizedPriority = this.normalizePriority(todo.priority);
        return {
            ...todo,
            list: normalizedList,
            area: normalizedArea,
            priority: normalizedPriority,
        };
    }

    getListLabel(listName) {
        const normalized =
            this.normalizeListName(listName) || this.availableLists[0];
        return normalized === "inbox" ? "Inbox" : "Today";
    }

    getAreaLabel(area) {
        const normalized = this.normalizeArea(area);
        if (!normalized) {
            return "";
        }
        return normalized.charAt(0).toUpperCase() + normalized.slice(1);
    }

    getPriorityLabel(priority) {
        const normalized = this.normalizePriority(priority);
        switch (normalized) {
            case "low":
                return "Low";
            case "medium":
                return "Medium";
            case "high":
                return "High";
            default:
                return "Not set";
        }
    }

    // --- API ---

    async request(url, options = {}) {
        const response = await fetch(url, {
            headers: {
                "Content-Type": "application/json",
            },
            credentials: "same-origin",
            ...options,
        });

        if (response.status === 401) {
            window.location.href = "/login";
            return {};
        }

        if (!response.ok) {
            const errorBody = await response.json().catch(() => ({}));
            const message = errorBody.detail || "Something went wrong.";
            throw new Error(message);
        }

        return response.json();
    }

    setStatus(message) {
        if (!this.statusMessage) {
            return;
        }
        this.statusMessage.textContent = message;
        if (message) {
            this.statusMessage.classList.add("visible");
        } else {
            this.statusMessage.classList.remove("visible");
        }
    }

    async loadTodos() {
        try {
            const data = await this.request("/api/todos");
            this.todos = (data.todos || []).map((todo) =>
                this.normalizeTodo(todo)
            );
            this.renderTodos();
        } catch (error) {
            this.setStatus(error.message);
        }
    }

    async addTodo() {
        const title = this.todoInput.value.trim();
        if (!title) {
            return;
        }
        const area = this.normalizeArea(this.areaSelect?.value);
        const priority = this.normalizePriority(this.prioritySelect?.value);

        // Determine target list from current view
        let targetList = "inbox";
        if (this.currentView.type === "list") {
            targetList = this.currentView.value;
        }

        this.addButton.disabled = true;
        this.setStatus("");

        try {
            const data = await this.request("/api/todos", {
                method: "POST",
                body: JSON.stringify({
                    title,
                    list: targetList,
                    area,
                    priority,
                }),
            });
            if (data.todo) {
                this.todos.unshift(this.normalizeTodo(data.todo));
                this.todoInput.value = "";
                if (this.areaSelect) {
                    this.areaSelect.value = "";
                }
                if (this.prioritySelect) {
                    this.prioritySelect.value = "not_set";
                }
                this.renderTodos();
                this.todoInput.focus();
            }
        } catch (error) {
            this.setStatus(error.message);
        } finally {
            this.addButton.disabled = false;
        }
    }

    async toggleTodo(id) {
        const todo = this.todos.find((item) => item.id === id);
        if (!todo) {
            return;
        }

        this.setStatus("");
        try {
            const data = await this.request(`/api/todos/${id}`, {
                method: "PATCH",
                body: JSON.stringify({ completed: !todo.completed }),
            });
            if (data.todo) {
                this.applyTodoUpdate(data.todo);
                this.renderTodos();
            }
        } catch (error) {
            this.setStatus(error.message);
        }
    }

    async deleteTodo(id) {
        this.setStatus("");
        try {
            await this.request(`/api/todos/${id}`, {
                method: "DELETE",
            });
            this.todos = this.todos.filter((todo) => todo.id !== id);
            this.renderTodos();
        } catch (error) {
            this.setStatus(error.message);
        }
    }

    async moveTodo(id, targetList) {
        this.setStatus("");
        try {
            const data = await this.request(`/api/todos/${id}`, {
                method: "PATCH",
                body: JSON.stringify({ list: targetList }),
            });
            if (data.todo) {
                this.applyTodoUpdate(data.todo);
                this.renderTodos();
            }
        } catch (error) {
            this.setStatus(error.message);
        }
    }

    async setArea(id, area) {
        this.setStatus("");
        try {
            const data = await this.request(`/api/todos/${id}`, {
                method: "PATCH",
                body: JSON.stringify({ area }),
            });
            if (data.todo) {
                this.applyTodoUpdate(data.todo);
                this.renderTodos();
            }
        } catch (error) {
            this.setStatus(error.message);
        }
    }

    async setPriority(id, priority) {
        this.setStatus("");
        try {
            const normalized = this.normalizePriority(priority);
            const data = await this.request(`/api/todos/${id}`, {
                method: "PATCH",
                body: JSON.stringify({ priority: normalized }),
            });
            if (data.todo) {
                this.applyTodoUpdate(data.todo);
                this.renderTodos();
            }
        } catch (error) {
            this.setStatus(error.message);
        }
    }

    async clearCompleted() {
        this.setStatus("");
        try {
            let url = "/api/todos/completed";
            if (this.currentView.type === "list") {
                const params = new URLSearchParams({
                    list: this.currentView.value,
                });
                url += `?${params.toString()}`;
            }
            await this.request(url, { method: "DELETE" });

            if (this.currentView.type === "list") {
                this.todos = this.todos.filter(
                    (todo) =>
                        !(
                            todo.completed &&
                            todo.list === this.currentView.value
                        )
                );
            } else {
                this.todos = this.todos.filter((todo) => !todo.completed);
            }
            this.renderTodos();
        } catch (error) {
            this.setStatus(error.message);
        }
    }

    // --- Menu management ---

    closeAllMenus() {
        this.todoList
            .querySelectorAll(".todo-item.menu-open")
            .forEach((item) => {
                item.classList.remove("menu-open");
            });
        this.todoList.querySelectorAll(".menu-btn").forEach((button) => {
            button.setAttribute("aria-expanded", "false");
        });
    }

    toggleMenu(item, button) {
        const shouldOpen = !item.classList.contains("menu-open");
        this.closeAllMenus();
        if (shouldOpen) {
            item.classList.add("menu-open");
            button.setAttribute("aria-expanded", "true");
        }
    }

    applyTodoUpdate(updated) {
        this.todos = this.todos.map((todo) => {
            if (todo.id !== updated.id) {
                return todo;
            }
            const merged = { ...todo, ...updated };
            return this.normalizeTodo(merged);
        });
    }

    // --- Filtering ---

    getFilteredTodos() {
        const view = this.currentView;
        switch (view.type) {
            case "list":
                return this.todos.filter(
                    (todo) => todo.list === view.value && !todo.completed
                );
            case "view":
                if (view.value === "all") {
                    return this.todos.filter((todo) => !todo.completed);
                }
                if (view.value === "completed") {
                    return this.todos.filter((todo) => todo.completed);
                }
                return this.todos;
            case "area":
                return this.todos.filter(
                    (todo) => todo.area === view.value && !todo.completed
                );
            default:
                return this.todos;
        }
    }

    // --- Rendering ---

    renderTodos() {
        const todos = this.getFilteredTodos();

        if (todos.length === 0) {
            const label = this.getViewLabel();
            this.todoList.innerHTML = `<li class="empty-state">No tasks in ${this.escapeHtml(label)} yet.</li>`;
            this.updateItemCount();
            this.updateSidebarCounts();
            return;
        }

        this.todoList.innerHTML = todos
            .map((todo, index) => {
                const checked = todo.completed ? "checked" : "";
                const completedClass = todo.completed ? "completed" : "";
                const normalizedPriority = this.normalizePriority(
                    todo.priority
                );
                const priorityClass = `priority-${normalizedPriority}`;

                const alternateList =
                    this.availableLists.find((list) => list !== todo.list) ||
                    this.availableLists[0];
                const moveLabel = `Move to ${this.getListLabel(alternateList)}`;

                const areaLabel = this.getAreaLabel(todo.area);
                const areaMarkup = areaLabel
                    ? `<span class="todo-meta-chip todo-area">${this.escapeHtml(areaLabel)}</span>`
                    : "";

                const priorityLabel =
                    this.getPriorityLabel(normalizedPriority);
                const priorityMarkup = `<span class="todo-meta-chip todo-priority ${priorityClass}">${this.escapeHtml(priorityLabel)}</span>`;

                const listLabel =
                    this.currentView.type !== "list"
                        ? `<span class="todo-meta-chip">${this.escapeHtml(this.getListLabel(todo.list))}</span>`
                        : "";

                const hasMeta =
                    areaLabel ||
                    normalizedPriority !== "not_set" ||
                    listLabel;
                const metadataMarkup = hasMeta
                    ? `<div class="todo-meta">${listLabel}${areaMarkup}${priorityMarkup}</div>`
                    : "";

                return `
                <li class="todo-item ${completedClass} ${priorityClass}" style="animation-delay: ${index * 25}ms">
                    <input type="checkbox" class="todo-checkbox" data-id="${todo.id}" ${checked}>
                    <div class="todo-content">
                        <span class="todo-text ${completedClass}">${this.escapeHtml(todo.title)}</span>
                        ${metadataMarkup}
                    </div>
                    <div class="todo-actions">
                        <button class="menu-btn" data-id="${todo.id}" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Task actions">...</button>
                        <div class="todo-menu" role="menu">
                            <button class="todo-menu-item change-list-btn" data-id="${todo.id}" type="button" data-target-list="${alternateList}" role="menuitem">${this.escapeHtml(moveLabel)}</button>
                            <button class="todo-menu-item set-area-btn" data-id="${todo.id}" type="button" data-area="personal" role="menuitem">Area: Personal</button>
                            <button class="todo-menu-item set-area-btn" data-id="${todo.id}" type="button" data-area="work" role="menuitem">Area: Work</button>
                            <button class="todo-menu-item set-area-btn" data-id="${todo.id}" type="button" data-area="" role="menuitem">Clear area</button>
                            <button class="todo-menu-item set-priority-btn" data-id="${todo.id}" type="button" data-priority="high" role="menuitem">Priority: High</button>
                            <button class="todo-menu-item set-priority-btn" data-id="${todo.id}" type="button" data-priority="medium" role="menuitem">Priority: Medium</button>
                            <button class="todo-menu-item set-priority-btn" data-id="${todo.id}" type="button" data-priority="low" role="menuitem">Priority: Low</button>
                            <button class="todo-menu-item set-priority-btn" data-id="${todo.id}" type="button" data-priority="not_set" role="menuitem">Clear priority</button>
                            <button class="todo-menu-item delete-btn" data-id="${todo.id}" type="button" role="menuitem">Delete</button>
                        </div>
                    </div>
                </li>`;
            })
            .join("");

        this.updateItemCount();
        this.updateSidebarCounts();
    }

    updateItemCount() {
        const filtered = this.getFilteredTodos();
        const count = filtered.length;
        this.itemCount.textContent = `${count} ${count === 1 ? "task" : "tasks"}`;
    }

    updateSidebarCounts() {
        const activeTodos = this.todos.filter((t) => !t.completed);
        const completedTodos = this.todos.filter((t) => t.completed);

        // List counts
        document.querySelectorAll("[data-count-list]").forEach((el) => {
            const list = el.dataset.countList;
            const count = activeTodos.filter((t) => t.list === list).length;
            el.textContent = count > 0 ? String(count) : "";
        });

        // View counts
        document.querySelectorAll("[data-count-view]").forEach((el) => {
            const view = el.dataset.countView;
            if (view === "all") {
                el.textContent =
                    activeTodos.length > 0 ? String(activeTodos.length) : "";
            } else if (view === "completed") {
                el.textContent =
                    completedTodos.length > 0
                        ? String(completedTodos.length)
                        : "";
            }
        });

        // Area counts
        document.querySelectorAll("[data-count-area]").forEach((el) => {
            const area = el.dataset.countArea;
            const count = activeTodos.filter((t) => t.area === area).length;
            el.textContent = count > 0 ? String(count) : "";
        });
    }

    escapeHtml(text) {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }
}

const app = new TodoApp();
