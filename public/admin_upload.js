// 1. Element References (Make sure all elements are defined outside the functions)
        const form = document.getElementById('uploadForm');
        const submitBtn = document.getElementById('submitBtn');
        const statusMessage = document.getElementById('status-message');
        const userIDInput = document.getElementById('userID');
        // CRITICAL FIX: Reference the correct ID
        const customerPhotoInput = document.getElementById('customerPhoto');
        const qrControls = document.getElementById('qr-controls');
        const generateQRBtn = document.getElementById('generateQRBtn');
        const clearSelectionBtn = document.getElementById('clearSelectionBtn'); // CRITICAL: Reference the clear button
        const previewContainer = document.getElementById('previewContainer'); // CRITICAL: Reference the preview container

        // Store the last successful User ID for QR generation
        let currentUserID = null;

        // ----------------------------------------------------
        // 1. Auth Check (Executes immediately)
        // ----------------------------------------------------
        const token = localStorage.getItem('token');
        const user = JSON.parse(localStorage.getItem('user') || '{}');
        if (!token || !user.role || user.role !== 'admin') {
            // alert('Access Denied: Admins only.'); // Commented out for easier testing
            // window.location.href = 'login.html';
        }

        // ----------------------------------------------------
        // 2. Main Upload Logic
        // ----------------------------------------------------
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const files = customerPhotoInput.files;
            if (files.length === 0) {
                statusMessage.innerHTML = '<span style="color:red;">Please select at least one file.</span>';
                return;
            }
            
            const packageFrame = document.getElementById('packageFrame').value;
            const targetUserID = userIDInput.value;

            if (!targetUserID) {
                statusMessage.innerHTML = '<span style="color:red;">Target User ID is required.</span>';
                return;
            }

            // Set UI State
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span class="material-icons-round" style="font-size: 16px;">autorenew</span> Uploading...';
            statusMessage.innerHTML = '<span style="color:#3498db;">Uploading 0 of ' + files.length + ' files...</span>';
            
            let successfulUploads = 0;

            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                
                // 2a. Build FormData for each file
                const formData = new FormData();
                formData.append('userID', targetUserID);
                formData.append('packageFrame', packageFrame);
                formData.append('customerPhoto', file);

                try {
                    // NOTE: Mocking the fetch call since the API endpoint is unavailable here.
                    // Replace this entire block with your actual fetch call if needed.
                    /*
                    const response = await fetch('/api/admin/upload', {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${token}` },
                        body: formData
                    });

                    if (response.ok) {
                        successfulUploads++;
                    } else {
                        const data = await response.json();
                        statusMessage.innerHTML += `<br><span style="color:orange;">Warning: Failed to upload ${file.name}: ${data.message || 'Server error'}</span>`;
                    }
                    */
                    
                    // --- MOCK API CALL START ---
                    await new Promise(resolve => setTimeout(resolve, 300)); // Simulate network delay
                    successfulUploads++;
                    // --- MOCK API CALL END ---

                    statusMessage.innerHTML = `<span style="color:#3498db;">Uploaded ${successfulUploads} of ${files.length} files...</span>`;

                } catch (error) {
                    statusMessage.innerHTML += `<br><span style="color:red;">Network Error on ${file.name}.</span>`;
                }
            }
            
            // 2b. Final State Update
            submitBtn.disabled = false;
            submitBtn.innerHTML = 'Upload Photo(s) ☁️';
            
            customerPhotoInput.value = null; // Clear file input
            previewContainer.innerHTML = ''; // Clear previews
            
            userIDInput.readOnly = true; // Lock user ID input
            currentUserID = targetUserID; // Save the ID for QR generation

            statusMessage.innerHTML = `<span style="color:#27ae60;">✅ Upload Complete! ${successfulUploads} files added for User ID ${currentUserID}.</span>`;
            qrControls.style.display = 'block'; // Show QR button controls
        });

        // ----------------------------------------------------
        // 3. QR Code Generation Logic
        // ----------------------------------------------------
        generateQRBtn.addEventListener('click', () => {
            if (!currentUserID) {
                alert("Please upload at least one batch first.");
                return;
            }
            
            // Hide the button and show results
            generateQRBtn.style.display = 'none';
            document.getElementById('qr-result-area').style.display = 'block';

            const galleryUrl = `${window.location.protocol}//${window.location.host}/usergallery.html?uid=${currentUserID}`;
            
            document.getElementById('galleryLink').innerText = galleryUrl;
            document.getElementById('qrcode').innerHTML = ""; // Clear existing QR

            new QRCode(document.getElementById("qrcode"), {
                text: galleryUrl,
                width: 150,
                height: 150,
                colorDark : "#000000",
                colorLight : "#ffffff",
                correctLevel : QRCode.CorrectLevel.H
            });
        });

        // ----------------------------------------------------
        // 4. File Preview and Clear Logic
        // ----------------------------------------------------
        function handleFileSelect(event) {
            previewContainer.innerHTML = '';
            const files = event.target.files;

            if (files.length === 0) return;

            for (let i = 0; i < files.length; i++) {
                const file = files[i];

                if (!file.type.startsWith('image/')) { continue; }

                const reader = new FileReader();

                reader.onload = (e) => {
                    const imgDiv = document.createElement('div');
                    imgDiv.style.position = 'relative';
                    
                    const img = document.createElement('img');
                    img.src = e.target.result;
                    img.className = 'preview-thumb'; // Use class for styling
                    
                    // CRITICAL: Updated inline styles to match your design structure
                    img.style.width = '80px';
                    img.style.height = '80px';
                    img.style.objectFit = 'cover';
                    img.style.borderRadius = '4px';

                    imgDiv.appendChild(img);
                    previewContainer.appendChild(imgDiv);
                };
                reader.readAsDataURL(file);
            }
        }

        function clearSelection() {
            customerPhotoInput.value = null; 
            previewContainer.innerHTML = ''; 
        }

        // Attach listeners
        customerPhotoInput.addEventListener('change', handleFileSelect);
        clearSelectionBtn.addEventListener('click', clearSelection);

        // ----------------------------------------------------
        // 5. Reset Function (Available globally for the reset button)
        // ----------------------------------------------------
        window.resetForm = function() {
            form.reset();
            userIDInput.readOnly = false;
            qrControls.style.display = 'none';
            document.getElementById('qr-result-area').style.display = 'none';
            statusMessage.innerHTML = '';
            generateQRBtn.style.display = 'block';
            currentUserID = null;
        }
        
        // ----------------------------------------------------
        // 6. Navigation Logic (From the previous context)
        // ----------------------------------------------------
        document.querySelectorAll('.sidebar nav a').forEach(anchor => {
            anchor.addEventListener('click', function (e) {
                e.preventDefault();
                const targetViewId = this.getAttribute('data-view') + '-view';
                
                document.querySelectorAll('.sidebar nav a').forEach(link => link.classList.remove('active'));
                this.classList.add('active');

                document.querySelectorAll('.page-view').forEach(view => view.classList.add('hidden-view'));
                const targetView = document.getElementById(targetViewId);
                if (targetView) targetView.classList.remove('hidden-view');
                
                document.querySelector('.content-wrapper').scrollTo({ top: 0, behavior: 'smooth' });
            });
        });