// Grip To-Do App - Frontend JavaScript (Supabase-backed)

class TodoApp {
    constructor() {
        this.todos = [];
        this.currentView = { type: "list", value: "inbox" };
        this.availableLists = ["inbox", "today"];
        this.availableAreas = ["personal", "work"];
        this.availablePriorities = ["not_set", "low", "medium", "high"];
        this.addTaskVisible = false;
        this.openTodoId = null;
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
        this.startDateInput = document.getElementById("startDateInput");
        this.plannedDateInput = document.getElementById("plannedDateInput");
        this.deadlineInput = document.getElementById("deadlineInput");
        this.durationInput = document.getElementById("durationInput");
        this.todoList = document.getElementById("todoList");
        this.itemCount = document.getElementById("itemCount");
        this.clearCompletedButton = document.getElementById("clearCompleted");
        this.statusMessage = document.getElementById("statusMessage");
        this.activeListLabel = document.getElementById("activeListLabel");
        this.sidebarItems = Array.from(
            document.querySelectorAll(".sidebar-item")
        );
        // Modal elements
        this.taskModal = document.getElementById("taskModal");
        this.modalCloseBtn = document.getElementById("modalCloseBtn");
        this.modalDeleteBtn = document.getElementById("modalDeleteBtn");
        this.modalCheckbox = document.getElementById("modalCheckbox");
        this.modalTitleInput = document.getElementById("modalTitleInput");
        this.modalList = document.getElementById("modal-list");
        this.modalPlannedDate = document.getElementById("modal-planned-date");
        this.modalStartDate = document.getElementById("modal-start-date");
        this.modalDuration = document.getElementById("modal-duration");
        this.modalDeadline = document.getElementById("modal-deadline");
        this.modalPriority = document.getElementById("modal-priority");
        this.modalArea = document.getElementById("modal-area");
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
                return;
            }
            if (event.target.classList.contains("set-date-input")) {
                const id = Number(event.target.dataset.id);
                const field = event.target.dataset.field;
                const value = event.target.value || null;
                this.closeAllMenus();
                this.setDateField(id, field, value);
                return;
            }
            if (event.target.classList.contains("set-duration-input")) {
                const id = Number(event.target.dataset.id);
                const value = event.target.value ? Number(event.target.value) : null;
                this.closeAllMenus();
                this.setDuration(id, value);
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
                return;
            }

            // Open detail modal when clicking on task content (not checkbox or actions)
            if (
                !event.target.closest(".todo-checkbox") &&
                !event.target.closest(".todo-actions")
            ) {
                const item = event.target.closest(".todo-item");
                if (item) {
                    const id = Number(item.dataset.id);
                    this.openModal(id);
                }
            }
        });

        // Close menus on outside click
        document.addEventListener("click", (event) => {
            if (!event.target.closest(".todo-actions")) {
                this.closeAllMenus();
            }
        });

        // Escape to close menus, modal, and hide add-task row
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                this.closeAllMenus();
                this.closeModal();
                this.hideAddTask();
            }
        });

        // Modal close / delete
        this.modalCloseBtn.addEventListener("click", () => this.closeModal());
        this.modalDeleteBtn.addEventListener("click", () => {
            if (this.openTodoId) {
                this.deleteTodo(this.openTodoId);
                this.closeModal();
            }
        });

        // Click outside modal content closes it
        this.taskModal.addEventListener("click", (event) => {
            if (event.target === this.taskModal) this.closeModal();
        });

        // Modal checkbox
        this.modalCheckbox.addEventListener("change", () => {
            if (this.openTodoId) this.toggleTodo(this.openTodoId);
        });

        // Modal title auto-save on blur
        this.modalTitleInput.addEventListener("blur", () => this.saveModalTitle());
        this.modalTitleInput.addEventListener("keydown", (event) => {
            if (event.key === "Enter") this.modalTitleInput.blur();
        });

        // Modal field auto-save on change + immediate visual state sync
        [
            { el: this.modalList,        field: "list" },
            { el: this.modalPlannedDate, field: "planned_date" },
            { el: this.modalStartDate,   field: "start_date" },
            { el: this.modalDuration,    field: "duration" },
            { el: this.modalDeadline,    field: "deadline" },
            { el: this.modalPriority,    field: "priority" },
            { el: this.modalArea,        field: "area" },
        ].forEach(({ el, field }) => {
            if (!el) return;
            el.addEventListener("change", () => {
                this._syncModalFieldStates();
                this.saveModalField(field, el.value);
            });
            // Remove is-editing on blur if still unset
            el.addEventListener("blur", () => {
                const fieldEl = el.closest(".modal-field");
                if (fieldEl && !fieldEl.classList.contains("is-set")) {
                    fieldEl.classList.remove("is-editing");
                }
            });
        });

        // Click on an unset modal field to reveal its input
        this.taskModal.addEventListener("click", (event) => {
            if (event.target === this.taskModal) return; // handled above
            const field = event.target.closest(".modal-field");
            if (!field || field.classList.contains("is-set") || field.classList.contains("is-editing")) return;
            field.classList.add("is-editing");
            const input = field.querySelector("input.modal-field-input");
            if (input) {
                input.focus();
                input.showPicker?.();
            }
        });

        // Collapsible sidebar sections
        document.querySelectorAll(".sidebar-section-toggle").forEach((btn) => {
            btn.addEventListener("click", () => {
                const navId = btn.dataset.toggleSection;
                const nav = document.getElementById(navId);
                if (!nav) return;
                const expanded = btn.getAttribute("aria-expanded") === "true";
                btn.setAttribute("aria-expanded", String(!expanded));
                nav.classList.toggle("collapsed", expanded);
            });
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
        const startDate = this.startDateInput?.value || null;
        const plannedDate = this.plannedDateInput?.value || null;
        const deadline = this.deadlineInput?.value || null;
        const duration = this.durationInput?.value ? Number(this.durationInput.value) : null;

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
                    start_date: startDate,
                    planned_date: plannedDate,
                    deadline,
                    duration,
                }),
            });
            if (data.todo) {
                this.todos.unshift(this.normalizeTodo(data.todo));
                this.todoInput.value = "";
                if (this.areaSelect) this.areaSelect.value = "";
                if (this.prioritySelect) this.prioritySelect.value = "not_set";
                if (this.startDateInput) this.startDateInput.value = "";
                if (this.plannedDateInput) this.plannedDateInput.value = "";
                if (this.deadlineInput) this.deadlineInput.value = "";
                if (this.durationInput) this.durationInput.value = "";
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

    async setDateField(id, field, value) {
        this.setStatus("");
        try {
            const data = await this.request(`/api/todos/${id}`, {
                method: "PATCH",
                body: JSON.stringify({ [field]: value }),
            });
            if (data.todo) {
                this.applyTodoUpdate(data.todo);
                this.renderTodos();
            }
        } catch (error) {
            this.setStatus(error.message);
        }
    }

    async setDuration(id, value) {
        this.setStatus("");
        try {
            const data = await this.request(`/api/todos/${id}`, {
                method: "PATCH",
                body: JSON.stringify({ duration: value }),
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
        // Refresh modal if it's open for this task
        if (this.openTodoId === updated.id) {
            const refreshed = this.todos.find((t) => t.id === updated.id);
            if (refreshed) this.populateModal(refreshed);
        }
    }

    // --- Date helper ---

    getToday() {
        return new Date().toISOString().split("T")[0];
    }

    // --- Modal ---

    openModal(id) {
        const todo = this.todos.find((t) => t.id === id);
        if (!todo) return;
        this.openTodoId = id;
        this.populateModal(todo);
        this.taskModal.hidden = false;
    }

    populateModal(todo) {
        this.modalCheckbox.checked = todo.completed;
        this.modalTitleInput.value = todo.title;
        this.modalList.value = todo.list || "inbox";
        this.modalPlannedDate.value = todo.planned_date || "";
        this.modalStartDate.value = todo.start_date || "";
        this.modalDuration.value = todo.duration || "";
        this.modalDeadline.value = todo.deadline || "";
        this.modalPriority.value = this.normalizePriority(todo.priority);
        this.modalArea.value = todo.area || "";
        this._syncModalFieldStates();
    }

    _syncModalFieldStates() {
        [
            { el: this.modalList,        isSet: () => true },
            { el: this.modalPlannedDate, isSet: () => !!this.modalPlannedDate.value },
            { el: this.modalStartDate,   isSet: () => !!this.modalStartDate.value },
            { el: this.modalDuration,    isSet: () => !!this.modalDuration.value && Number(this.modalDuration.value) > 0 },
            { el: this.modalDeadline,    isSet: () => !!this.modalDeadline.value },
            { el: this.modalPriority,    isSet: () => this.modalPriority.value !== "not_set" },
            { el: this.modalArea,        isSet: () => !!this.modalArea.value },
        ].forEach(({ el, isSet }) => {
            if (!el) return;
            const field = el.closest(".modal-field");
            if (!field) return;
            const set = isSet();
            field.classList.toggle("is-set", set);
            if (set) field.classList.remove("is-editing");
        });
    }

    closeModal() {
        if (!this.taskModal.hidden) {
            this.taskModal.hidden = true;
            this.openTodoId = null;
        }
    }

    async saveModalTitle() {
        const title = this.modalTitleInput.value.trim();
        if (!title || !this.openTodoId) return;
        const todo = this.todos.find((t) => t.id === this.openTodoId);
        if (todo && todo.title === title) return; // no change
        this.setStatus("");
        try {
            const data = await this.request(`/api/todos/${this.openTodoId}`, {
                method: "PATCH",
                body: JSON.stringify({ title }),
            });
            if (data.todo) {
                this.applyTodoUpdate(data.todo);
                this.renderTodos();
            }
        } catch (error) {
            this.setStatus(error.message);
        }
    }

    async saveModalField(field, value) {
        if (!this.openTodoId) return;
        let payload;
        if (field === "duration") {
            payload = { duration: value ? Number(value) : null };
        } else if (field === "list") {
            payload = { list: value };
        } else {
            payload = { [field]: value || null };
        }
        this.setStatus("");
        try {
            const data = await this.request(`/api/todos/${this.openTodoId}`, {
                method: "PATCH",
                body: JSON.stringify(payload),
            });
            if (data.todo) {
                this.applyTodoUpdate(data.todo);
                this.renderTodos();
            }
        } catch (error) {
            this.setStatus(error.message);
        }
    }

    // --- Filtering ---

    getFilteredTodos() {
        const view = this.currentView;
        switch (view.type) {
            case "list":
                if (view.value === "today") {
                    const today = this.getToday();
                    return this.todos.filter(
                        (t) => !t.completed && (t.list === "today" || t.planned_date === today)
                    );
                }
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

                const startDateMarkup = todo.start_date
                    ? `<span class="todo-meta-chip todo-start-date">Start: ${this.escapeHtml(todo.start_date)}</span>`
                    : "";
                const plannedDateMarkup = todo.planned_date
                    ? `<span class="todo-meta-chip todo-planned-date">Plan: ${this.escapeHtml(todo.planned_date)}</span>`
                    : "";
                const deadlineMarkup = todo.deadline
                    ? `<span class="todo-meta-chip todo-deadline">Due: ${this.escapeHtml(todo.deadline)}</span>`
                    : "";
                const durationMarkup = todo.duration
                    ? `<span class="todo-meta-chip todo-duration">${this.escapeHtml(String(todo.duration))}m</span>`
                    : "";

                const hasMeta =
                    areaLabel ||
                    normalizedPriority !== "not_set" ||
                    listLabel ||
                    todo.start_date ||
                    todo.planned_date ||
                    todo.deadline ||
                    todo.duration;
                const metadataMarkup = hasMeta
                    ? `<div class="todo-meta">${listLabel}${startDateMarkup}${plannedDateMarkup}${deadlineMarkup}${durationMarkup}${areaMarkup}${priorityMarkup}</div>`
                    : "";

                return `
                <li class="todo-item ${completedClass} ${priorityClass}" data-id="${todo.id}" style="animation-delay: ${index * 25}ms">
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
                            <label class="todo-menu-item todo-menu-date-item" role="menuitem">
                                <span>Start date</span>
                                <input type="date" class="set-date-input" data-id="${todo.id}" data-field="start_date" value="${todo.start_date || ''}">
                            </label>
                            <label class="todo-menu-item todo-menu-date-item" role="menuitem">
                                <span>Planned date</span>
                                <input type="date" class="set-date-input" data-id="${todo.id}" data-field="planned_date" value="${todo.planned_date || ''}">
                            </label>
                            <label class="todo-menu-item todo-menu-date-item" role="menuitem">
                                <span>Deadline</span>
                                <input type="date" class="set-date-input" data-id="${todo.id}" data-field="deadline" value="${todo.deadline || ''}">
                            </label>
                            <label class="todo-menu-item todo-menu-date-item" role="menuitem">
                                <span>Duration (min)</span>
                                <input type="number" class="set-duration-input" data-id="${todo.id}" value="${todo.duration || ''}" min="1" placeholder="—">
                            </label>
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

        // List counts (Today includes tasks with planned_date === today)
        const todayStr = this.getToday();
        document.querySelectorAll("[data-count-list]").forEach((el) => {
            const list = el.dataset.countList;
            const count =
                list === "today"
                    ? activeTodos.filter(
                          (t) => t.list === "today" || t.planned_date === todayStr
                      ).length
                    : activeTodos.filter((t) => t.list === list).length;
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
