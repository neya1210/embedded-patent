using System;
using System.Linq;
using System.Windows;
using System.Windows.Input;
using System.Threading.Tasks;
using Windows.UI.Input.Inking.Analysis;
using Windows.UI.Input.Inking;

namespace StylusNotebook
{
    public partial class MainWindow : Window
    {
        private string[] questions = new string[]
        {
            "Q1: Write the name of your favorite fruit.",
            "Q2: What is the capital city of your country?",
            "Q3: Write a short welcome message."
        };
        private int currentQuestionIndex = 0;
        private bool isProcessing = false;

        public MainWindow()
        {
            InitializeComponent();
            
            // Set up InkCanvas for perfect pen support
            var drawingAttributes = new System.Windows.Ink.DrawingAttributes();
            drawingAttributes.Color = System.Windows.Media.Colors.Black;
            drawingAttributes.Width = 4;
            drawingAttributes.Height = 4;
            drawingAttributes.FitToCurve = true; // Smooths the ink natively
            MyInkCanvas.DefaultDrawingAttributes = drawingAttributes;

            UpdateQuestion();
        }

        private void UpdateQuestion()
        {
            QuestionText.Text = questions[currentQuestionIndex];
            MyInkCanvas.Strokes.Clear();
        }

        private void ClearBtn_Click(object sender, RoutedEventArgs e)
        {
            MyInkCanvas.Strokes.Clear();
        }

        private void NextBtn_Click(object sender, RoutedEventArgs e)
        {
            currentQuestionIndex = (currentQuestionIndex + 1) % questions.Length;
            UpdateQuestion();
        }

        // Detect Touch (Finger) to trigger Reading
        private void MyInkCanvas_TouchDown(object sender, TouchEventArgs e)
        {
            e.Handled = true; // Prevent the finger from drawing ink
            ReadHandwriting();
        }

        // Backup detection: In case a device registers a finger as a Stylus with Touch type
        private void MyInkCanvas_StylusDown(object sender, StylusDownEventArgs e)
        {
            if (e.StylusDevice.TabletDevice.Type == TabletDeviceType.Touch)
            {
                e.Handled = true; // Prevent the finger from drawing ink
                ReadHandwriting();
            }
        }

        private async void ReadHandwriting()
        {
            if (isProcessing || MyInkCanvas.Strokes.Count == 0) return;
            isProcessing = true;
            Overlay.Visibility = Visibility.Visible;
            OverlayText.Text = "Analyzing Handwriting...";

            try
            {
                var analyzer = new InkAnalyzer();
                var builder = new InkStrokeBuilder();

                // Convert WPF Strokes to WinRT Strokes WITH Pressure Data for much better AI recognition
                foreach (var stroke in MyInkCanvas.Strokes)
                {
                    var inkPoints = stroke.StylusPoints.Select(p => 
                        new Windows.UI.Input.Inking.InkPoint(
                            new Windows.Foundation.Point(p.X, p.Y), 
                            p.PressureFactor) // Pass X, Y, and Pen Pressure
                        ).ToList();
                        
                    // Create stroke from points
                    var winRtStroke = builder.CreateStrokeFromInkPoints(
                        inkPoints, 
                        System.Numerics.Matrix3x2.Identity);
                        
                    analyzer.AddDataForStroke(winRtStroke);
                }

                // Run the native Windows Handwriting AI
                var results = await analyzer.AnalyzeAsync();

                if (results.Status == InkAnalysisStatus.Updated)
                {
                    var recognizedText = analyzer.AnalysisRoot.RecognizedText;
                    
                    if (string.IsNullOrWhiteSpace(recognizedText))
                    {
                        OverlayText.Text = "No readable text found.";
                        await Task.Delay(2000);
                    }
                    else
                    {
                        OverlayText.Text = "Speaking...";
                        Speak(recognizedText);
                    }
                }
            }
            catch (Exception ex)
            {
                OverlayText.Text = "Error analyzing ink.";
                await Task.Delay(2000);
            }
            finally
            {
                Overlay.Visibility = Visibility.Collapsed;
                isProcessing = false;
            }
        }

        private void Speak(string text)
        {
            try
            {
                // Use built-in Windows COM Text-to-Speech (SAPI)
                Type type = Type.GetTypeFromProgID("SAPI.SpVoice");
                dynamic spVoice = Activator.CreateInstance(type);
                // Run asynchronously on a background thread so it doesn't freeze the UI
                Task.Run(() => spVoice.Speak(text));
            }
            catch
            {
                MessageBox.Show("Text-to-speech failed to initialize.");
            }
        }
    }
}