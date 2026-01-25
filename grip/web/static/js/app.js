// Grip To-Do App - Frontend JavaScript (Supabase-backed)

class TodoApp {
    constructor() {
        this.todos = [];
        this.currentFilter = "all";
        this.cacheElements();
        this.bindEvents();
        this.loadTodos();
    }

    cacheElements() {
        this.todoInput = document.getElementById("todoInput");
        this.addButton = document.getElementById("addBtn");
        this.todoList = document.getElementById("todoList");
        this.itemCount = document.getElementById("itemCount");
        this.clearCompletedButton = document.getElementById("clearCompleted");
        this.statusMessage = document.getElementById("statusMessage");
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
            if (event.target.classList.contains("delete-btn")) {
                const id = Number(event.target.dataset.id);
                this.deleteTodo(id);
            }
        });
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
            this.todos = data.todos || [];
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
                body: JSON.stringify({ title }),
            });
            if (data.todo) {
                this.todos.unshift(data.todo);
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

    async clearCompleted() {
        this.setStatus("");
        try {
            await this.request("/api/todos/completed", { method: "DELETE" });
            this.todos = this.todos.filter((todo) => !todo.completed);
            this.renderTodos();
        } catch (error) {
            this.setStatus(error.message);
        }
    }

    applyTodoUpdate(updated) {
        this.todos = this.todos.map((todo) =>
            todo.id === updated.id ? updated : todo
        );
    }

    getFilteredTodos() {
        switch (this.currentFilter) {
            case "active":
                return this.todos.filter((todo) => !todo.completed);
            case "completed":
                return this.todos.filter((todo) => todo.completed);
            default:
                return this.todos;
        }
    }

    renderTodos() {
        const todos = this.getFilteredTodos();

        if (todos.length === 0) {
            this.todoList.innerHTML =
                '<li class="empty-state">No tasks yet. Add one above!</li>';
            this.updateItemCount();
            return;
        }

        this.todoList.innerHTML = todos
            .map((todo, index) => {
                const checked = todo.completed ? "checked" : "";
                const completedClass = todo.completed ? "completed" : "";
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
                <button class="delete-btn" data-id="${todo.id}">Delete</button>
            </li>
        `;
            })
            .join("");

        this.updateItemCount();
    }

    updateItemCount() {
        const activeCount = this.todos.filter((todo) => !todo.completed).length;
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

const app = new TodoApp();
