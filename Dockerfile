FROM python:3.12-alpine

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Create unprivileged user & group
RUN addgroup -g 1000 appgroup && \
    adduser -u 1000 -G appgroup -s /bin/sh -D appuser

# Create data directories with appropriate permissions
RUN mkdir -p /app/data/projects && \
    chown -R appuser:appgroup /app

# Copy application source
COPY --chown=appuser:appgroup backend /app/backend
COPY --chown=appuser:appgroup static /app/static
COPY --chown=appuser:appgroup scripts /app/scripts

USER appuser

EXPOSE 8080

HEALTHCHECK --interval=20s --timeout=3s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/api/health', timeout=2)" || exit 1

CMD ["python", "-m", "backend.main"]
