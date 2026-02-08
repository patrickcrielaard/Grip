// Grip To-Do App - Frontend JavaScript (Supabase-backed)

class TodoApp {
    constructor() {
        this.todos = [];
        this.currentFilter = "all";
        this.availableLists = ["inbox", "today"];
        this.availableAreas = ["personal", "work"];
        this.availablePriorities = ["not_set", "low", "medium", "high"];
        this.currentList = this.availableLists[0];
        this.cacheElements();
        this.bindEvents();
        this.setActiveList(this.getInitialList());
        this.loadTodos();
    }

    cacheElements() {
        this.todoInput = document.getElementById("todoInput");
        this.addButton = document.getElementById("addBtn");
        this.areaSelect = document.getElementById("areaSelect");
        this.prioritySelect = document.getElementById("prioritySelect");
        this.todoList = document.getElementById("todoList");
        this.itemCount = document.getElementById("itemCount");
        this.clearCompletedButton = document.getElementById("clearCompleted");
        this.statusMessage = document.getElementById("statusMessage");
        this.listButtons = Array.from(
            document.querySelectorAll(".sidebar-item[data-list]")
        );
        this.activeListLabel = document.getElementById("activeListLabel");
    }

    bindEvents() {
        this.addButton.addEventListener("click", () => this.addTodo());
        this.todoInput.addEventListener("keypress", (event) => {
            if (event.key === "Enter") {
                this.addTodo();
            }
        });

        document.querySelectorAll(".filter-btn").forEach((button) => {
            button.addEventListener("click", (event) => {
                document
                    .querySelectorAll(".filter-btn")
                    .forEach((btn) => btn.classList.remove("active"));
                event.target.classList.add("active");
                this.currentFilter = event.target.dataset.filter;
                this.renderTodos();
            });
        });

        this.listButtons.forEach((button) => {
            button.addEventListener("click", () => {
                this.setActiveList(button.dataset.list);
            });
        });

        this.clearCompletedButton.addEventListener("click", () =>
            this.clearCompleted()
        );

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

        document.addEventListener("click", (event) => {
            if (!event.target.closest(".todo-actions")) {
                this.closeAllMenus();
            }
        });

        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                this.closeAllMenus();
            }
        });
    }

    getInitialList() {
        const activeButton = this.listButtons.find((button) =>
            button.classList.contains("active")
        );
        return activeButton?.dataset.list || this.currentList;
    }

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
        const button = this.listButtons.find(
            (listButton) => listButton.dataset.list === normalized
        );
        const label = button?.querySelector(".sidebar-label")?.textContent;
        if (label) {
            return label.trim();
        }
        return normalized.charAt(0).toUpperCase() + normalized.slice(1);
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

    setActiveList(listName) {
        const normalized =
            this.normalizeListName(listName) || this.availableLists[0];
        let targetButton = this.listButtons.find(
            (button) => button.dataset.list === normalized
        );
        if (!targetButton && this.listButtons.length > 0) {
            targetButton = this.listButtons[0];
        }
        if (!targetButton) {
            this.currentList = normalized;
            return;
        }
        this.listButtons.forEach((button) => {
            const isActive = button === targetButton;
            button.classList.toggle("active", isActive);
            button.setAttribute("aria-pressed", isActive.toString());
        });
        this.currentList = targetButton.dataset.list || normalized;
        if (this.activeListLabel) {
            this.activeListLabel.textContent = this.getListLabel(
                this.currentList
            );
        }
        this.renderTodos();
    }

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

        this.addButton.disabled = true;
        this.setStatus("");

        try {
            const data = await this.request("/api/todos", {
                method: "POST",
                body: JSON.stringify({
                    title,
                    list: this.currentList,
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
            const params = new URLSearchParams({ list: this.currentList });
            await this.request(`/api/todos/completed?${params.toString()}`, {
                method: "DELETE",
            });
            this.todos = this.todos.filter(
                (todo) => !(todo.completed && todo.list === this.currentList)
            );
            this.renderTodos();
        } catch (error) {
            this.setStatus(error.message);
        }
    }

    closeAllMenus() {
        this.todoList.querySelectorAll(".todo-item.menu-open").forEach((item) => {
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

    getFilteredTodos() {
        const listTodos = this.todos.filter(
            (todo) => todo.list === this.currentList
        );
        switch (this.currentFilter) {
            case "active":
                return listTodos.filter((todo) => !todo.completed);
            case "completed":
                return listTodos.filter((todo) => todo.completed);
            default:
                return listTodos;
        }
    }

    renderTodos() {
        const todos = this.getFilteredTodos();

        if (todos.length === 0) {
            const listLabel = this.getListLabel(this.currentList);
            this.todoList.innerHTML =
                `<li class="empty-state">No tasks in ${this.escapeHtml(
                    listLabel
                )} yet. Add one above!</li>`;
            this.updateItemCount();
            return;
        }

        this.todoList.innerHTML = todos
            .map((todo, index) => {
                const checked = todo.completed ? "checked" : "";
                const completedClass = todo.completed ? "completed" : "";
                const alternateList =
                    this.availableLists.find((list) => list !== todo.list) ||
                    this.availableLists[0];
                const moveLabel = `Move to ${this.getListLabel(alternateList)}`;
                const areaLabel = this.getAreaLabel(todo.area);
                const areaMarkup = areaLabel
                    ? `<span class="todo-meta-chip todo-area">${this.escapeHtml(
                          areaLabel
                      )}</span>`
                    : "";
                const normalizedPriority = this.normalizePriority(todo.priority);
                const priorityLabel = this.getPriorityLabel(normalizedPriority);
                const priorityMarkup = `<span class="todo-meta-chip todo-priority priority-${normalizedPriority}">${this.escapeHtml(
                    priorityLabel
                )}</span>`;
                const metadataMarkup = `<div class="todo-meta">${areaMarkup}${priorityMarkup}</div>`;
                return `
            <li class="todo-item ${completedClass}" style="animation-delay: ${
                    index * 30
                }ms">
                <input 
                    type="checkbox" 
                    class="todo-checkbox" 
                    data-id="${todo.id}"
                    ${checked}
                >
                <div class="todo-content">
                    <span class="todo-text ${completedClass}">${this.escapeHtml(
                        todo.title
                    )}</span>
                    ${metadataMarkup}
                </div>
                <div class="todo-actions">
                    <button class="menu-btn" data-id="${
                        todo.id
                    }" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Task actions">...</button>
                    <div class="todo-menu" role="menu">
                        <button class="todo-menu-item change-list-btn" data-id="${
                            todo.id
                        }" type="button" data-target-list="${alternateList}" role="menuitem">${this.escapeHtml(
                            moveLabel
                        )}</button>
                        <button class="todo-menu-item set-area-btn" data-id="${
                            todo.id
                        }" type="button" data-area="personal" role="menuitem">Set area: Personal</button>
                        <button class="todo-menu-item set-area-btn" data-id="${
                            todo.id
                        }" type="button" data-area="work" role="menuitem">Set area: Work</button>
                        <button class="todo-menu-item set-area-btn" data-id="${
                            todo.id
                        }" type="button" data-area="" role="menuitem">Clear area</button>
                        <button class="todo-menu-item set-priority-btn" data-id="${
                            todo.id
                        }" type="button" data-priority="high" role="menuitem">Set priority: High</button>
                        <button class="todo-menu-item set-priority-btn" data-id="${
                            todo.id
                        }" type="button" data-priority="medium" role="menuitem">Set priority: Medium</button>
                        <button class="todo-menu-item set-priority-btn" data-id="${
                            todo.id
                        }" type="button" data-priority="low" role="menuitem">Set priority: Low</button>
                        <button class="todo-menu-item set-priority-btn" data-id="${
                            todo.id
                        }" type="button" data-priority="not_set" role="menuitem">Set priority: Not set</button>
                        <button class="todo-menu-item delete-btn" data-id="${
                            todo.id
                        }" type="button" role="menuitem">Delete task</button>
                    </div>
                </div>
            </li>
        `;
            })
            .join("");

        this.updateItemCount();
    }

    updateItemCount() {
        const activeCount = this.todos.filter(
            (todo) => !todo.completed && todo.list === this.currentList
        ).length;
        this.itemCount.textContent = `${activeCount} ${
            activeCount === 1 ? "item" : "items"
        }`;
    }

    escapeHtml(text) {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }
}

const setupSidebarToggle = () => {
    const sidebar = document.querySelector(".sidebar");
    const shell = document.querySelector(".todo-shell");
    const toggle = document.querySelector(".sidebar-toggle");
    if (!sidebar || !shell || !toggle) {
        return;
    }

    toggle.addEventListener("click", () => {
        const collapsed = sidebar.classList.toggle("collapsed");
        shell.classList.toggle("sidebar-collapsed", collapsed);
        toggle.setAttribute("aria-expanded", (!collapsed).toString());

        const icon = toggle.querySelector(".toggle-icon");
        const label = toggle.querySelector(".toggle-label");
        if (icon) {
            icon.textContent = collapsed ? ">>" : "<<";
        }
        if (label) {
            label.textContent = collapsed ? "Expand" : "Collapse";
        }
    });
};

setupSidebarToggle();
const app = new TodoApp();
