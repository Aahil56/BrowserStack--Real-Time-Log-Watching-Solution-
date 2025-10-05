const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
let lastSize = 0;

// Initializing file size
try {
    const stats = fs.statSync('./test.txt');
    lastSize = stats.size;
} catch (error) {
    console.log('test.txt not found, will create when first log is added');
    lastSize = 0;
}
// Serve HTML file
app.get('/', (req, res) => res.sendFile(__dirname + '/client.html'));

// Optimized function to get last N lines from large files
function getLastLines(filePath, count = 10) {
    try {
        const stats = fs.statSync(filePath);
        const fileSize = stats.size;
        
        if (fileSize === 0) return [];
        
        // For small files (< 1MB), read normally
        if (fileSize < 1024 * 1024) {
            const content = fs.readFileSync(filePath, 'utf8');
            return content.split('\n').slice(-count).filter(line => line.trim());
        }
        
        // For large files, reading from end in chunks
        const fd = fs.openSync(filePath, 'r');
        const buffer = Buffer.alloc(64 * 1024); // 64KB buffer
        let lines = [];
        let position = fileSize;
        
        while (lines.length < count && position > 0) {
            const readSize = Math.min(buffer.length, position);
            position -= readSize;
            fs.readSync(fd, buffer, 0, readSize, position);
            
            const chunk = buffer.toString('utf8', 0, readSize);
            const newLines = chunk.split('\n');
            lines = [...newLines.slice(1), ...lines];
        }
        
        fs.closeSync(fd);
        return lines.slice(-count).filter(line => line.trim());
    } catch (error) {
        console.log('Error reading file:', error.message);
        return [];
    }
}

// Function to read only new content
function readNewContent(filePath, startPosition) {
    try {
        const fd = fs.openSync(filePath, 'r');
        const stats = fs.statSync(filePath);
        const currentSize = stats.size;
        
        if (currentSize <= startPosition) {
            fs.closeSync(fd);
            return { content: '', newSize: currentSize };
        }
        
        const readSize = currentSize - startPosition;
        const buffer = Buffer.alloc(readSize);
        fs.readSync(fd, buffer, 0, readSize, startPosition);
        fs.closeSync(fd);
        
        return { content: buffer.toString('utf8'), newSize: currentSize };
    } catch (error) {
        console.log('Error reading new content:', error.message);
        return { content: '', newSize: startPosition };
    }
}

// Socket.IO connection
io.on('connection', (socket) => {
    console.log('Client connected');
    
    // Sending last 10 lines when client connects
    const lines = getLastLines('./test.txt');
    socket.emit('lastLines', lines);
    
    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

// Using fs.watch for faster file monitoring
fs.watch('./test.txt', (eventType) => {
    console.log(`File changed: ${eventType}`);
    if (eventType === 'change') {
        const { content, newSize } = readNewContent('./test.txt', lastSize);
        
        if (content) {
            console.log(`New content detected: ${content.length} characters`);
            lastSize = newSize;
            const lines = content.split('\n').filter(line => line.trim());
            console.log(`Broadcasting ${lines.length} new lines to clients`);
            lines.forEach(line => {
                io.emit('newLog', line);
            });
        }
    }
});

server.listen(3000, () => console.log('Server running on http://localhost:3000'));