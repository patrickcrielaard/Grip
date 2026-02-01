// Grip To-Do App - Frontend JavaScript (Supabase-backed)

class TodoApp {
    constructor() {
        this.todos = [];
        this.currentFilter = "all";
        this.availableLists = ["inbox", "today"];
        this.currentList = this.availableLists[0];
        this.cacheElements();
        this.bindEvents();
        this.setActiveList(this.getInitialList());
        this.loadTodos();
    }

    cacheElements() {
        this.todoInput = document.getElementById("todoInput");
        this.addButton = document.getElementById("addBtn");
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

    normalizeTodo(todo) {
        const normalizedList =
            this.normalizeListName(todo.list) || this.availableLists[0];
        return { ...todo, list: normalizedList };
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

        this.addButton.disabled = true;
        this.setStatus("");

        try {
            const data = await this.request("/api/todos", {
                method: "POST",
                body: JSON.stringify({ title, list: this.currentList }),
            });
            if (data.todo) {
                this.todos.unshift(this.normalizeTodo(data.todo));
                this.todoInput.value = "";
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
                <span class="todo-text ${completedClass}">${this.escapeHtml(
                    todo.title
                )}</span>
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
